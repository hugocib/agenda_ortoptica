-- v1.4: cada ato/MCDT tem a sua ficha de relatório (secções, parâmetros, frase de técnica e
-- normativos por idade), guardada em JSON. A ficha é criada no arranque a partir do modelo que
-- o ato usava e dos normativos antigos (ver fillForms em db.js).
ALTER TABLE exam_types ADD COLUMN form TEXT;
