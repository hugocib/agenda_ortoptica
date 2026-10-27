-- v1.3: o limite diário passa a ser de cada ato/MCDT (p. ex. «ERG: máx. 2 por dia»), em vez de
-- um limite global de eletrofisiologia. Os atos de eletrofisiologia herdam o limite antigo.
ALTER TABLE exam_types ADD COLUMN max_per_day INTEGER CHECK (max_per_day IS NULL OR max_per_day BETWEEN 1 AND 20);
UPDATE exam_types SET max_per_day = (
  SELECT CASE WHEN CAST(value AS INTEGER) BETWEEN 1 AND 20 THEN CAST(value AS INTEGER) END FROM settings WHERE key = 'max_electro_per_day'
) WHERE is_electro = 1;
DELETE FROM settings WHERE key = 'max_electro_per_day';
