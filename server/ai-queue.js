const queueError = code => Object.assign(new Error(code), { status: 503 });

// One provider stream. Dispatch on the next turn so the review worker can refill
// its priority lane before an ordinary answer takes the newly released slot.
export function createAIQueue({ maxWaiting = 50, moderationReserve = 10, maxWaitMs = 120000 } = {}) {
  const moderation = [];
  const answers = [];
  let running = false;
  let scheduled = false;
  function schedule() {
    if (scheduled || running) return;
    scheduled = true;
    setImmediate(() => { scheduled = false; drain(); });
  }
  function drain() {
    if (running) return;
    const item = moderation.shift() || answers.shift();
    if (!item) return;
    clearTimeout(item.timer);
    running = true;
    void (async () => {
      try {
        if (item.canRun && !item.canRun()) throw queueError('AI_CANCELLED');
        item.resolve(await item.run());
      } catch (error) { item.reject(error); }
      finally { running = false; schedule(); }
    })();
  }
  return {
    enqueue(run, { priority = 'answer', canRun } = {}) {
      const lane = priority === 'moderation' ? moderation : answers;
      if (moderation.length + answers.length >= maxWaiting ||
          (lane === answers && answers.length >= maxWaiting - moderationReserve))
        return Promise.reject(queueError('AI_QUEUE_FULL'));
      return new Promise((resolve, reject) => {
        const item = { run, canRun, resolve, reject };
        item.timer = setTimeout(() => {
          const index = lane.indexOf(item);
          if (index < 0) return;
          lane.splice(index, 1);
          reject(queueError('AI_QUEUE_TIMEOUT'));
          schedule();
        }, maxWaitMs);
        lane.push(item);
        schedule();
      });
    },
  };
}
