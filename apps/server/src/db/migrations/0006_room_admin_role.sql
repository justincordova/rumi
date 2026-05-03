-- Promote all existing 'member' rows to 'admin' so existing rooms keep
-- behaving like today (admins can create/delete/reorder tabs). New members
-- default to 'member' and need an owner promotion to gain admin powers.
UPDATE room_members SET role = 'admin' WHERE role = 'member';
