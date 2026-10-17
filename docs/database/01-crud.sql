-- Run in a separate empty training database, never in medium.sqlite.
PRAGMA foreign_keys=ON;
CREATE TABLE students (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  language TEXT NOT NULL
) STRICT;
INSERT INTO students(name,language) VALUES ('Анна','Русский');
SELECT id,name,language FROM students;
UPDATE students SET language='English' WHERE id=1;
SELECT * FROM students WHERE id=1;
DELETE FROM students WHERE id=1;
SELECT count(*) AS remaining FROM students;
