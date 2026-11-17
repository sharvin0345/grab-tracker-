# Set up RideTarget

Do this on your iPhone, in Safari. You only do it once.

The driver app will be here:

https://sharvin0345.github.io/grab-tracker-/ridetarget/

The owner page (approve buyers) will be here:

https://sharvin0345.github.io/grab-tracker-/ridetarget/admin.html

Your old tracker at the main site address stays as it is.

Until the keys are saved, the app shows **Not connected yet**. That is normal.

## 1. Make a free Supabase project

1. Open https://supabase.com and create a free account.
2. Tap **New project**.
3. Pick a name, a database password (save it in Notes), and a region close to Malaysia if you see one (Singapore is a good choice).
4. Wait until the project says it is ready. This can take a minute.

## 2. Run the database script

1. In the Supabase project, open **SQL Editor** (left side).
2. Tap **New query**.
3. On your computer this file is `ridetarget/supabase-setup.sql`. On the iPhone, open the GitHub file:
   https://github.com/sharvin0345/grab-tracker-/blob/main/ridetarget/supabase-setup.sql
4. Tap **Raw**, then select all the text and copy it.
5. Paste it into the Supabase query box.
6. Tap **Run**.
7. You want a success message. Grey NOTICE lines are fine. Red error text is not. If you see red text, copy it and run the script again only after reading the error. Running the whole script again is safe.

## 3. Copy the URL and the anon key

1. In Supabase, open **Project Settings** (the gear) → **API** or **API Keys**.
2. Copy **Project URL**. It looks like `https://abcdefg.supabase.co`.
3. Copy the **publishable** key. It starts with `sb_publishable_`. The older **anon public** key (a long text starting with `eyJ`) also works.
4. Do **not** copy a key that starts with `sb_secret_` or one labelled **service_role**. The app will refuse it. Anyone with that key could read every account.

## 4. Paste the keys into the app

1. On the iPhone, open https://github.com/sharvin0345/grab-tracker- and sign in to GitHub.
2. Tap **ridetarget**, then **config.js**.
3. Tap the pencil (**Edit**).
4. Replace `YOUR_SUPABASE_URL` with the Project URL. Keep the quote marks.
5. Replace `YOUR_SUPABASE_ANON_KEY` with the anon public key. Keep the quote marks.
6. Tap **Commit changes**. Leave the branch as **main**.
7. Wait 1–2 minutes. GitHub Pages updates from main.
8. Open the app link and pull to refresh. The “Not connected yet” screen should be gone.

## 5. Tell Supabase which website may sign people in

1. In Supabase open **Authentication** → **URL Configuration**.
2. Set **Site URL** to:

   https://sharvin0345.github.io/grab-tracker-/ridetarget/

3. Under **Redirect URLs**, add both of these (tap Add for each):

   https://sharvin0345.github.io/grab-tracker-/ridetarget/

   https://sharvin0345.github.io/grab-tracker-/ridetarget/index.html

4. Save.

## 6. Email confirmation

1. Open **Authentication** → **Sign In / Providers** → **Email**.
2. Leave Email turned on.
3. **Confirm email**:
   - Turn it **off** if you want a new driver to land on the waiting screen right after sign-up.
   - Turn it **on** if you want them to tap a link in their email before they can log in.
4. Either way, they cannot use the tracker until you tap **Approve**.

## 7. Make yourself the owner

1. Open the app link and tap **Sign up**. Use the email you want as the owner.
2. If you turned confirmation on, open the email and tap the link, then log in.
3. You should see the waiting screen. That is correct. You are not approved yet.
4. Go back to Supabase → **SQL Editor** → **New query**.
5. Paste this line and change the email to yours. Then tap **Run**:

```sql
update public.profiles set is_admin = true, approved = true where email = 'you@email.com';
```

6. Open the app and tap **Refresh**. You should get into the tracker.
7. Open the owner page and log in with the same email. You should see yourself in the list.

## 8. Approve a buyer

1. The buyer opens the app link, taps **Sign up**, and uses their email.
2. They see: “Your account is waiting for activation…”
3. They send you that email (they can tap **Copy email**).
4. You open the owner page, find that email (use the search box), and tap **Approve**.
5. Tell them to open the app and tap **Refresh**.

**Revoke** locks them out again. Their rides stay saved. Approve them later and the rides come back.

## 9. WhatsApp number and price

Open `ridetarget/config.js`. Change only these three lines:

- `WHATSAPP_NUMBER` — your WhatsApp number, country code first, digits only. Example: `60123456789`
- `PRICE_RM` — the normal lifetime price (20)
- `LAUNCH_PRICE_RM` — the price you charge now (15)

Save the file to `main`. The Buy button and the waiting screen use that number.

## 10. Put it on the Home Screen

In Safari, open the app link → Share → **Add to Home Screen**. The name is RideTarget.

## If something goes wrong

- The page still says **Not connected yet**: the keys in `config.js` were not saved, or Pages has not updated. Wait a minute and refresh.
- It says **Wrong key**: you pasted a secret key (`sb_secret_` or service_role). Replace it with the publishable key.
- A buyer says they paid but still see the waiting screen: on the owner page, check that their email shows **Approved**, then ask them to tap **Refresh**.
- Reset-password email opens a blank page or an error: add both redirect URLs from step 5, send a new reset from the app, and open the email link in Safari (not inside Gmail’s preview).
- You cannot see other people on the owner page: step 7 did not run, or the email does not match the one you signed up with. Run the update line again with the exact email.
