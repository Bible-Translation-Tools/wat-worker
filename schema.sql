DROP TABLE IF EXISTS Batches;

CREATE TABLE
    IF NOT EXISTS Batches (id TEXT PRIMARY KEY, total INTEGER);

DROP TABLE IF EXISTS Words;

CREATE TABLE
    IF NOT EXISTS Words (
        id INTEGER PRIMARY KEY,
        word TEXT NOT NULL,
        result TEXT,
        batch_id TEXT,
        FOREIGN KEY (batch_id) REFERENCES Batches (id) ON DELETE CASCADE
    );