CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL CHECK(json_valid(value))) STRICT;
CREATE TABLE users (
 id TEXT PRIMARY KEY, position INTEGER NOT NULL CHECK(position>=0),
 first_name TEXT NOT NULL, last_name TEXT NOT NULL, direction TEXT NOT NULL,
 about TEXT NOT NULL, email TEXT NOT NULL, course INTEGER NOT NULL CHECK(course BETWEEN 1 AND 6),
 languages TEXT NOT NULL CHECK(json_valid(languages)), interests TEXT NOT NULL CHECK(json_valid(interests)),
 skills TEXT NOT NULL CHECK(json_valid(skills)), credential TEXT NOT NULL CHECK(json_valid(credential)),
 extras TEXT NOT NULL CHECK(json_valid(extras))
) STRICT;
CREATE TABLE questions (
 id TEXT PRIMARY KEY, position INTEGER NOT NULL CHECK(position>=0), author_id TEXT NOT NULL REFERENCES users(id),
 title TEXT NOT NULL, body TEXT NOT NULL, category TEXT NOT NULL, created_at REAL NOT NULL,
 extras TEXT NOT NULL CHECK(json_valid(extras))
) STRICT;
CREATE TABLE answers (
 id TEXT PRIMARY KEY, position INTEGER NOT NULL CHECK(position>=0), question_id TEXT NOT NULL REFERENCES questions(id),
 author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, rating INTEGER CHECK(rating BETWEEN 1 AND 5),
 created_at REAL NOT NULL, extras TEXT NOT NULL CHECK(json_valid(extras))
) STRICT;
CREATE TABLE help_requests (
 id TEXT PRIMARY KEY, position INTEGER NOT NULL CHECK(position>=0), author_id TEXT NOT NULL REFERENCES users(id),
 subject TEXT NOT NULL, body TEXT NOT NULL, helper_id TEXT REFERENCES users(id),
 status TEXT NOT NULL CHECK(status IN ('open','assigned','completed')), rating INTEGER CHECK(rating BETWEEN 1 AND 5),
 created_at REAL NOT NULL, extras TEXT NOT NULL CHECK(json_valid(extras)),
 CHECK((status='open' AND helper_id IS NULL AND rating IS NULL) OR (status IN ('assigned','completed') AND helper_id IS NOT NULL)),
 CHECK(status!='assigned' OR rating IS NULL)
) STRICT;
CREATE TABLE help_offers (
 help_id TEXT NOT NULL REFERENCES help_requests(id), position INTEGER NOT NULL CHECK(position>=0),
 user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(help_id,position)
) STRICT;
CREATE TABLE chats (
 id TEXT PRIMARY KEY, position INTEGER NOT NULL CHECK(position>=0), extras TEXT NOT NULL CHECK(json_valid(extras))
) STRICT;
CREATE TABLE chat_members (
 chat_id TEXT NOT NULL REFERENCES chats(id), user_id TEXT NOT NULL REFERENCES users(id),
 position INTEGER NOT NULL CHECK(position IN (0,1)), PRIMARY KEY(chat_id,user_id), UNIQUE(chat_id,position)
) STRICT;
CREATE TABLE messages (
 chat_id TEXT NOT NULL REFERENCES chats(id), id TEXT NOT NULL, position INTEGER NOT NULL CHECK(position>=0),
 sender_id TEXT NOT NULL, body TEXT NOT NULL, created_at REAL NOT NULL, extras TEXT NOT NULL CHECK(json_valid(extras)),
 PRIMARY KEY(chat_id,id), FOREIGN KEY(chat_id,sender_id) REFERENCES chat_members(chat_id,user_id)
) STRICT;
CREATE TABLE sessions (
 token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at REAL NOT NULL,
 extras TEXT NOT NULL CHECK(json_valid(extras))
) STRICT;
CREATE INDEX questions_author ON questions(author_id);
CREATE INDEX answers_question ON answers(question_id,position);
CREATE INDEX answers_author ON answers(author_id);
CREATE INDEX help_author ON help_requests(author_id);
CREATE INDEX help_helper ON help_requests(helper_id);
CREATE INDEX help_offers_user ON help_offers(user_id);
CREATE INDEX chat_members_user ON chat_members(user_id);
CREATE INDEX messages_chat ON messages(chat_id,position);
CREATE INDEX sessions_expiry ON sessions(expires_at);
PRAGMA user_version=1;

CREATE TABLE reports (
 id TEXT PRIMARY KEY, position INTEGER NOT NULL CHECK(position>=0),
 author_id TEXT NOT NULL REFERENCES users(id), reviewer_id TEXT REFERENCES users(id),
 key TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','resolved','dismissed')),
 created_at REAL NOT NULL, reviewed_at REAL, decision TEXT,
 present_fields TEXT NOT NULL CHECK(json_valid(present_fields)), extras TEXT NOT NULL CHECK(json_valid(extras))
) STRICT;
CREATE INDEX reports_author ON reports(author_id);
CREATE INDEX reports_reviewer ON reports(reviewer_id);

CREATE TABLE ai_feedback (
 id TEXT PRIMARY KEY, position INTEGER NOT NULL CHECK(position>=0),
 author_id TEXT NOT NULL REFERENCES users(id), reviewer_id TEXT REFERENCES users(id),
 key TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','resolved','dismissed')),
 created_at REAL NOT NULL, reviewed_at REAL, decision TEXT,
 present_fields TEXT NOT NULL CHECK(json_valid(present_fields)), extras TEXT NOT NULL CHECK(json_valid(extras))
) STRICT;
CREATE INDEX ai_feedback_author ON ai_feedback(author_id);
CREATE INDEX ai_feedback_reviewer ON ai_feedback(reviewer_id);

CREATE TABLE appeals (
 id TEXT PRIMARY KEY, position INTEGER NOT NULL CHECK(position>=0),
 author_id TEXT NOT NULL REFERENCES users(id), reviewer_id TEXT REFERENCES users(id),
 key TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','resolved','dismissed')),
 created_at REAL NOT NULL, reviewed_at REAL, decision TEXT,
 present_fields TEXT NOT NULL CHECK(json_valid(present_fields)), extras TEXT NOT NULL CHECK(json_valid(extras))
) STRICT;
CREATE INDEX appeals_author ON appeals(author_id);
CREATE INDEX appeals_reviewer ON appeals(reviewer_id);

CREATE TABLE moderation_log (
 position INTEGER PRIMARY KEY CHECK(position>=0), id TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL, target TEXT NOT NULL, reason TEXT NOT NULL, created_at REAL NOT NULL,
 extras TEXT NOT NULL CHECK(json_valid(extras))
) STRICT;
CREATE INDEX moderation_log_actor ON moderation_log(actor_id);
