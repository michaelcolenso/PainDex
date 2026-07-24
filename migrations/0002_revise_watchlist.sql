-- Revise the watchlist based on first-run yield analysis.
--
-- The first live run scored each subreddit by the share of posts the classifier
-- flagged as genuine high commercial intent (>= 3/10). Three structural losers
-- emerged: hobbyist/maker communities (people sharing projects, not running
-- businesses), pure marketplace subs (WTS/WTB listings the prefilter correctly
-- strips), and employee-not-owner subs. The winners are all owner-operator Q&A
-- communities. This migration prunes the dead weight and adds owner-operator
-- verticals that should carry stronger commercial-pain signal.
--
-- Pruned subs are soft-disabled (active = 0), not deleted, so their history is
-- kept and the choice stays reversible. Idempotent: safe to re-run.

-- Prune: hobbyist/maker + marketplace-listing + lowest-signal subreddits.
UPDATE subreddits SET active = 0 WHERE name IN (
  'discgolf',        -- 2% high-intent (hobby)
  'Pickleball',      -- hobby
  '3Dprinting',      -- 1% (hobby/maker)
  'beekeeping',      -- hobby
  'mushroomgrowers', -- 0% (hobby)
  'TinyHouses',      -- hobby
  'Skoolies',        -- hobby
  'sneakermarket',   -- marketplace listings
  'watchexchange',   -- marketplace listings (7 of 100 posts survived prefilter)
  'Vinyl_Collectors',-- marketplace listings
  'storageauctions', -- marketplace listings
  'Blacksmith',      -- 4% (hobby/maker)
  'Leathercraft',    -- 8% (hobby/maker)
  'Luthier'          -- hobby/maker
);

-- Add: owner-operator verticals where small-business owners ask operational and
-- regulatory "how do I..." questions.
INSERT OR IGNORE INTO subreddits (name, category, active) VALUES
  ('sweatystartup',    'operator', 1),
  ('smallbusiness',    'operator', 1),
  ('msp',              'operator', 1),
  ('ecommerce',        'operator', 1),
  ('pressurewashing',  'operator', 1),
  ('AutoDetailing',    'operator', 1),
  ('landscaping',      'operator', 1),
  ('EtsySellers',      'operator', 1),
  ('restaurantowners', 'regulated', 1),
  ('Bookkeeping',      'operator', 1);
