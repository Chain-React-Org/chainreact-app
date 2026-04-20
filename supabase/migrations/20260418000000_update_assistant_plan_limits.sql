-- Update AI assistant message limits per plan tier
-- Free: 20/month, Pro: 200/month, Team: 1000/month, Business: -1 (unlimited), Enterprise: -1 (unlimited)

UPDATE plans SET max_ai_assistant_calls = 20 WHERE name = 'free';
UPDATE plans SET max_ai_assistant_calls = 200 WHERE name = 'pro';
UPDATE plans SET max_ai_assistant_calls = 1000 WHERE name = 'team';
UPDATE plans SET max_ai_assistant_calls = -1 WHERE name = 'business';
UPDATE plans SET max_ai_assistant_calls = -1 WHERE name = 'enterprise';

-- Update plan features to include assistant capabilities
UPDATE plans SET features = features || '["Assistant (20 messages/mo)"]'::jsonb
WHERE name = 'free' AND NOT features::text LIKE '%Assistant%';

UPDATE plans SET features = features || '["Assistant (200 messages/mo)", "Document Q&A & web search"]'::jsonb
WHERE name = 'pro' AND NOT features::text LIKE '%Assistant%';

UPDATE plans SET features = features || '["Assistant (1,000 messages/mo)", "Cross-app search & session memory"]'::jsonb
WHERE name = 'team' AND NOT features::text LIKE '%Assistant%';

UPDATE plans SET features = features || '["Assistant (unlimited)", "Proactive insights & alerts"]'::jsonb
WHERE name = 'business' AND NOT features::text LIKE '%Assistant%';

UPDATE plans SET features = features || '["Assistant with custom knowledge base"]'::jsonb
WHERE name = 'enterprise' AND NOT features::text LIKE '%Assistant%';
