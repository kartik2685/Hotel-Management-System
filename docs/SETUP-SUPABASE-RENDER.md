# Website live karo: Supabase (database) + Render (server), step by step

Ye guide Hinglish me hai. Har click likha hai. Dono services **free** hain. Total time: lagbhag 15 minute.

## Pehle samjho: kaun kya karta hai

```
Guest / Staff ka browser  ──►  Render (website chalata hai, Singapore)  ──►  Supabase (sara data, Singapore)
```

| Cheez | Kaam |
|---|---|
| **GitHub** | Code yahan hai (`kartik2685/Hotel-Management-System`). Ye ho chuka hai. |
| **Supabase** | **Database.** Rooms, guests, bookings, payments, invoices, GRC, staff logins, emails: sab yahan save hota hai. |
| **Render** | **Server.** Website aur backend (Node.js) ka code chalata hai, aur data Supabase me rakhta hai. |

- Supabase akela website nahi chala sakta, aur Render ka free server apni files restart par mita deta hai.
  Isliye dono saath me: **code Render par, data Supabase par.** Restart, redeploy ya sleep se data kabhi nahi jaata.
- Supabase me **tables khud banane ki zaroorat nahi.** App pehli baar start hote hi 26 tables khud bana deta hai.
  SQL Editor me kuch run nahi karna.

---

## Part 1: Supabase (database), lagbhag 5 minute

1. <https://supabase.com> kholo → **Start your project** → **Continue with GitHub**.
2. **New project** par click karo aur bharo:
   - **Project name:** kuch bhi, jaise `hotel-db`
   - **Database password:** khud likho, **sirf letters aur numbers** (jaise `Hotel2026Kolkata9`), 12+ characters.
     `@ # / ? % :` jaise symbols mat daalo, warna connection string toot jaati hai.
     **Ye password Notepad me save kar lo.**
   - **Region:** **Southeast Asia (Singapore)**. Mumbai nahi: Render ka server Singapore me hoga, aur dono ek hi
     jagah hone chahiye, warna har page dheema chalega.
   - Plan **Free**, baaki sab default.
3. **Create new project** → 1-2 minute ruko jab tak project ready na ho.
4. Project ke upar **Connect** button dabao.
5. **Session pooler** chuno (list ya *Method* dropdown me) aur **URI** copy karo. Aisi dikhegi:
   ```
   postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```
6. `[YOUR-PASSWORD]` ko (brackets samet) apne database password se badlo:
   ```
   postgresql://postgres.abcdefghijklmnop:Hotel2026Kolkata9@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```
   Yahi aapka **DATABASE_URL** hai. Isse Notepad me rakho.

> **Dhyan do:**
> - **Direct connection** (`db.xxxx.supabase.co`) wali string **mat lena**. Wo sirf IPv6 par chalti hai, aur Render IPv6 nahi chalata.
> - Port **5432** hona chahiye (Session pooler). 6543 (Transaction pooler) nahi.
> - Is string me password hai: ise kisi ko mat bhejo, chat me bhi nahi. Ye sirf Render ke form me jayegi.

---

## Part 2: Render (server), lagbhag 5-10 minute

Repo me `render.yaml` (Blueprint) hai, isliye Render baaki sari settings khud bhar deta hai.

1. <https://render.com> kholo → **Get Started** → **GitHub** se sign up karo (account `kartik2685`).
2. Dashboard me **New +** → **Blueprint**.
3. List me `kartik2685/Hotel-Management-System` ke saamne **Connect** dabao.
   (Repo list me nahi hai? **Configure GitHub / Connect account** dabao aur Render ko is repo ka access do.)
4. Form bharo:
   - **Blueprint Name:** kuch bhi, jaise `hotel`
   - **Branch:** `arena/dfe46868-hotel-management-system`. **`main` nahi**: main me abhi sirf LICENSE file hai.
   - **Blueprint Path:** khali chhodo (`render.yaml`)
5. Render 4 values maangega:

   | Key | Kya likhna hai |
   |---|---|
   | `DATABASE_URL` | Part 1 wali string (password ke saath) |
   | `ADMIN_EMAIL` | Aapka email. Isi se login karoge |
   | `ADMIN_PASSWORD` | Login password, kam se kam 8 characters. (Khali chhoda to Logs me ek one-time password aayega, jo pehli baar login par badalna padega.) |
   | `HOTEL_NAME` | Hotel ka naam (baad me Admin → Hotel settings me badal sakte ho) |

6. **Deploy Blueprint** dabao. Pehli baar 3-5 minute lagte hain.
7. Service kholo → **Logs**. Ye lines dikhni chahiye:
   ```
   Database: PostgreSQL on aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   New database: empty hotel created. Sign in as aapka@email.com with the password in ADMIN_PASSWORD.
   Frontdesk is running on http://localhost:10000
   ```
   (`localhost:10000` Render ke andar ka port hai. Aapki website ka asli address Render page ke upar hai.)

> **Pehle se Render par Web Service bana chuke ho (haath se)?** Phir Blueprint mat banao, warna do services ban jayengi.
> Bas us service me **Environment** → **Add Environment Variable** → `DATABASE_URL` = Part 1 wali string →
> **Save and deploy** (ya Save karke **Manual Deploy → Deploy latest commit**).

> **Demo data chahiye (preview jaisa Harlow Hotel)?** Step 5 me `ADMIN_EMAIL` khali chhod do. Demo hotel load hoga, aur
> uska staff password Logs me ek baar dikhega: `Sign in as elena.marsh@example.com with this password: …`.
> Asli hotel ke liye `ADMIN_EMAIL` bharo: khali hotel banega, jisme aap apne rooms daloge.

---

## Part 3: Check karo ki sab Supabase se juda hai, 2 minute

1. Render page ke upar wala link kholo, jaise `https://hotel-management-system-xxxx.onrender.com`.
   Wahan se `/login` par jao aur `ADMIN_EMAIL` + `ADMIN_PASSWORD` se sign in karo.
2. Upar right me apne naam par click → **Admin panel** → **Overview**. Neeche **Database** card me dikhega:
   - **Supabase (PostgreSQL) · Singapore**
   - **Tables:** 26 · version 2
   - **Round trip:** kuch milliseconds. 15 ms se zyada ho to Supabase aur Render alag regions me hain.
   - Card me **laal box "The data is in a temporary file"** dikhe, to `DATABASE_URL` set nahi hua: Part 2 dobara dekho.
3. Supabase → **Table Editor**: `users`, `rooms`, `reservations`, `guests`… 26 tables dikhengi.
4. Pakka karne ke liye: koi room type add karo → Render me **Manual Deploy → Restart service** → website dobara kholo.
   Room type wahi milega. Data Supabase me safe hai.

---

## Part 4: Apna hotel set karo

**Admin panel** me is order me:
1. **Hotel settings:** naam, city, address, phone, GSTIN, **State** (GST invoice par chhapta hai), check-in/out time.
   **Website address** me apna Render link daalo (email ke links isi se bante hain), aur **Confirmation / Invoice
   number prefix** me `HTL` / `INV` ki jagah apne hotel ke letters (jaise `GVH`). Business date *Follow today’s date* hi rehne do.
2. **Room types** → **Rooms** → **Rates & extras** → **Booking sources**.
3. **Staff accounts:** har staff ko role ke saath add karo (admin, manager, frontdesk, housekeeping).
4. **Website:** guest website shuru me **off** hoti hai. Texts likho aur **on** karo. Guests `https://…onrender.com/hotel` par booking karenge.

---

## Roz ke liye zaroori baatein

- **Render free** 15 minute tak koi visitor na aaye to so jata hai. Agli baar khulne me lagbhag 1 minute lagta hai.
  Data safe rehta hai.
- **Supabase free** project 7 din tak bilkul use na ho to pause ho jata hai. Pehle email aata hai, aur dashboard me
  **Restore** se wapas chalu hota hai. Roz use karoge to pause nahi hoga. Free me 500 MB milta hai: chhote hotel ke liye kai saal.
- **Backup:** free plan me Supabase khud backup nahi rakhta. Hafte me ek baar **Admin → Overview → Download a backup**
  dabao. Ek `.db` file download hogi jisme har table hai. Use safe jagah rakho: usme guests ka data hai.
- **Naya code:** jab is branch par update push hoga, Render khud naya version deploy kar dega. Data nahi jayega.

---

## Problem aaye to: Render → Logs me dekho

App har galti par seedha batata hai ki kya theek karna hai:

| Logs me dikhe | Matlab | Kya karo |
|---|---|---|
| `password authentication failed` / `Wrong database password` | Password galat hai | Supabase → **Database → Settings → Reset database password** (sirf letters + numbers). 1-2 minute ruko, phir Render → **Environment** → `DATABASE_URL` me naya password daalo → **Save** |
| `still the placeholder [YOUR-PASSWORD]` / `not a valid connection string` | Password daalna bhool gaye, ya password me symbol hai | String dobara copy karo; password sirf letters + numbers rakho |
| `cannot reach the database over IPv6` / `ENETUNREACH` | Direct connection wali string daali hai | **Connect → Session pooler** wali string lo |
| `Tenant or user not found` | Username galat | Username `postgres.<project-ref>` hona chahiye: string dobara copy karo, haath se mat likho |
| `host name was not found` / `ENOTFOUND` | String me typo | Dobara copy-paste karo |
| `did not answer` / `timeout` | Supabase project paused, ya address galat | Supabase dashboard me project **Restore** karo; string check karo |
| `ADMIN_PASSWORD must be 8 to 200 characters long` | Password chhota hai | Render → **Environment** me lamba password daalo → **Save** |
| Website ke Database card me laal box | `DATABASE_URL` set nahi hai | Render → **Environment** me add karo |

**Environment** me kuch bhi badlo to save karte waqt **Save and deploy** jaisa option chuno. Na dikhe to save karke
**Manual Deploy → Deploy latest commit** dabao.

Supabase project galti se **Mumbai** (ya kisi aur region) me bana diya? Card me round trip zyada dikhega aur pages dheeme
chalenge. Free plan me 2 projects milte hain: Singapore me naya project banao aur uski string `DATABASE_URL` me daalo.
