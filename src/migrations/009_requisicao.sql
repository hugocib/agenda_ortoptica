-- v1.12: impresso de requisição gerado a partir dos atos/MCDTs.
-- req_group: em que grupo o ato aparece no impresso ('' = não aparece); req_prep: nota de
-- preparação para o doente, ao lado da duração (p. ex. «inclui dilatação»).
ALTER TABLE exam_types ADD COLUMN req_group TEXT NOT NULL DEFAULT '' CHECK (req_group IN ('', 'eletro', 'imagem', 'funcao'));
ALTER TABLE exam_types ADD COLUMN req_prep TEXT NOT NULL DEFAULT '';
UPDATE exam_types SET req_group = 'eletro' WHERE code IN ('erg', 'erg_pattern', 'pev', 'eog') AND kind = 'clinico';
UPDATE exam_types SET req_group = 'imagem' WHERE code IN ('oct', 'oct_ant', 'retino') AND kind = 'clinico';
UPDATE exam_types SET req_group = 'funcao' WHERE code IN ('micro', 'csf', 'ortoptica', 'eyetracking') AND kind = 'clinico';
UPDATE exam_types SET req_prep = 'inclui dilatação e cerca de 20 min de adaptação ao escuro' WHERE code = 'erg';
