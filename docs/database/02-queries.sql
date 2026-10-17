-- Read-only examples for medium.sqlite. Bind ? via prepared statements.
SELECT a.id, q.title AS question_title,
       trim(u.first_name || ' ' || u.last_name) AS author_name, a.body
FROM answers a
JOIN questions q ON q.id=a.question_id
JOIN users u ON u.id=a.author_id
WHERE a.question_id=?;

SELECT r.id,r.body,i.title AS item_title,u.login AS author
FROM lesson_records r
JOIN lesson_items i ON i.id=r.item_id
JOIN lesson_users u ON u.id=r.author_id
WHERE r.item_id=?;

EXPLAIN QUERY PLAN SELECT count(*) FROM answers WHERE question_id=?;
PRAGMA foreign_key_check;
PRAGMA integrity_check;
