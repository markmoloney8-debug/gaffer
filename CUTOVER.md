# Switching on real sign-in (gaffers5.com)

Do this when it is quiet (a weeknight, not match day). It takes about 15 minutes. The old app stops working for about two minutes between steps 5 and 6, so do those back to back.

## Before you start (nothing changes for players yet)
1. **Supabase → Authentication → Sign In / Providers → Email.** Turn **off** "Allow new users to sign up". (The Gaffer creates accounts itself; this stops anyone else creating one directly.) Leave "Confirm email" however it is.
2. **Supabase → Project Settings → API Keys.** Copy the **secret** key (starts `sb_secret_`). Never put it in the app.
3. **GitHub → repo → Settings → Secrets and variables → Actions → New repository secret.** Name `SUPABASE_SERVICE_KEY`, value the secret key. The hourly results, Tuesday fixtures, fixture-replace and feedback jobs use it from now on.
4. **Deploy the account function.** Either ask Claude to deploy it through the Supabase connector (it will ask you first), or from a terminal: `supabase functions deploy auth --no-verify-jwt`. The code is in `supabase/functions/auth/`.

## The switch
5. **Supabase → SQL Editor:** run `history-setup.sql`, then `hardening.sql`, then `auth/auth.sql` (all safe to run again). This locks the database down.
6. **GitHub:** upload the new files from this release (everything in the zip). Cloudflare builds and goes live in about a minute.

## Check it worked
7. Open gaffers5.com in a private window. Sign in as someone with an old account and their old password. It should just work.
8. Register a test player with a group code. Make an entry. Check you can see it on **My Entries**.
9. Sign in as yourself (MarkMolo). Open **Admin**, enter the PIN. You should see **Password resets**.
10. On the sign-in page tap **Forgot password?**, send a request for a made-up name, then check it appears in your Admin list. Dismiss it.
11. In GitHub → Actions, run **Update results** by hand. It should go green.

## If something is wrong
- Players who can't sign in with an old password under 6 characters: the app tells them to use **Forgot password?**, and you set them a temporary password from Admin.
- If you can't sign in as MarkMolo: Supabase → Authentication → Users → find `markmolo@gaffers5.com` → reset password. (Your account is moved across the first time you sign in with your usual password.)
- To pull the release: put the previous app files back on GitHub and run `auth/rollback.sql`.

## Telling friends
Share **gaffers5.com** (and group invite links from inside the app). Old links to the Netlify address can be left to expire.
