-- Fix UTF-8 double-encoding corruption in typing passage text.
-- ÔÇö is the latin1 misread of the UTF-8 em-dash (â€" / U+2014).
-- ÔÇô is the latin1 misread of the en-dash (â€" / U+2013).
-- Update ats_typing_passage_bank titles and passage_text (already fixed via API,
-- but included here for safety / re-apply idempotency).

UPDATE ats_typing_passage_bank
   SET title        = REPLACE(REPLACE(title,        'ÔÇö', '—'), 'ÔÇô', '–'),
       passage_text = REPLACE(REPLACE(passage_text, 'ÔÇö', '—'), 'ÔÇô', '–')
 WHERE title LIKE '%ÔÇö%' OR title LIKE '%ÔÇô%'
    OR passage_text LIKE '%ÔÇö%' OR passage_text LIKE '%ÔÇô%';

-- Fix reference_text in any typing attempts that have not yet been submitted
-- (submitted attempts are frozen; changing them would alter scored history).
UPDATE ats_typing_test_attempt
   SET reference_text = REPLACE(REPLACE(reference_text, 'ÔÇö', '—'), 'ÔÇô', '–')
 WHERE submitted_at IS NULL
   AND (reference_text LIKE '%ÔÇö%' OR reference_text LIKE '%ÔÇô%');
