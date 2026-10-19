# Website live karo: sab kuch Render par (website + backend + database)

Ye guide Hinglish me hai. Har click likha hai. Supabase ki zaroorat nahi: database bhi Render par hi banta hai.
Total time: lagbhag 10 minute, sirf ek baar.

## Code Render tak kaise pahunchta hai? Khud hoga ya manually?

```
Main yahan code banata hoon ──git push──► GitHub ──(har push par khud)──► Render ──► aapki website
```

**Ek baar aapko karna hai (lagbhag 10 minute, Part 1 neeche):** Render account banana aur Blueprint chalana.
Ye main nahi kar sakta, kyunki Render me aapke account se login chahiye.

**Uske baad sab khud hota hai:**
- Render database (`hotel-db`) aur website server (`hotel-management-system`) dono khud banata hai, aur dono ko
  jod deta hai. Database ka address (`DATABASE_URL`) Render khud bharta hai: koi copy-paste nahi.
- App pehli baar start hote hi database me 26 tables aur aapka admin account khud bana deta hai.
- Jab bhi main GitHub par naya code push karta hoon, Render 2-5 minute me khud naya version deploy kar deta hai.
  Aapko kuch nahi karna. Data database me safe rehta hai.

**Koi aur rasta?** Render Docker image ya Render CLI/API se bhi deploy kar sakta hai, par GitHub wala rasta sabse
aasaan hai aur yahi set hai. Files upload karne jaisa koi kaam nahi.

## Kharcha kitna?

| Cheez | Shuru me | Baad me |
|---|---|---|
| Website + backend (`hotel-management-system`) | **Free, hamesha.** 15 minute koi na aaye to so jata hai; agli baar khulne me ~1 minute | Hamesha jaagta chahiye to Starter plan, $7/month |
| Database (`hotel-db`, PostgreSQL) | **Sirf 30 din free** | 30 din se pehle upgrade: `0.1c-256mb`, lagbhag $6/month (+ storage $0.30/GB). Upgrade nahi kiya to 30 din par band, aur 14 din baad **saara data delete** |

Admin panel me 30 din ki ginti dikhti hai (Part 2), aur Render bhi email bhejta hai. Part 4 me upgrade ka tarika hai.

---

## Part 1: Render par deploy, lagbhag 10 minute

1. <https://render.com> kholo → **Get Started** → **GitHub** se sign up karo (account `kartik2685`).
2. Dashboard me **New +** → **Blueprint**.
3. List me `kartik2685/Hotel-Management-System` ke saamne **Connect** dabao.
   (Repo list me nahi hai? **Configure GitHub / Connect account** dabao aur Render ko is repo ka access do.)
4. Form bharo:
   - **Blueprint Name:** kuch bhi, jaise `hotel`
   - **Branch:** `arena/dfe46868-hotel-management-system`. **`main` nahi**: main me abhi sirf LICENSE file hai.
   - **Blueprint Path:** khali chhodo (`render.yaml`)
5. Render dikhayega ki do cheezein banengi: **hotel-management-system** (Web Service, Free) aur **hotel-db**
   (PostgreSQL, Free). Phir 3 values maangega:

   | Key | Kya likhna hai |
   |---|---|
   | `ADMIN_EMAIL` | Aapka email. Isi se login karoge |
   | `ADMIN_PASSWORD` | Login password, kam se kam 8 characters. (Khali chhoda to Logs me ek one-time password aayega, jo pehli baar login par badalna padega.) |
   | `HOTEL_NAME` | Hotel ka naam (baad me Admin → Hotel settings me badal sakte ho) |

6. **Deploy Blueprint** dabao. Pehli baar 5-10 minute lagte hain (pehle database banta hai, phir website).
7. **hotel-management-system** kholo → **Logs**. Ye lines dikhni chahiye:
   ```
   Database: PostgreSQL on dpg-xxxxxxxxxxxxxxxxxxxx-a:5432/frontdesk
   New database: empty hotel created. Sign in as aapka@email.com with the password in ADMIN_PASSWORD.
   Frontdesk is running on http://localhost:10000
   ```
   - Pehle `The database is not answering yet … trying again` dikhe to ghabrao mat: database abhi ban raha hai,
     app khud thodi der ruk kar dobara koshish karta hai.
   - `localhost:10000` Render ke andar ka port hai. Aapki website ka asli address Render page ke upar hai.

> **Pehle se Render par Web Service bana chuke ho (haath se)?** Us service me koi data nahi hai (bina database ke
> sab har restart par mit jata tha). Use hata do: service kholo → **Settings** → sabse neeche **Delete Web Service**.
> Phir upar wala Blueprint banao, taaki do services na banen.

> **Demo data chahiye (preview jaisa Harlow Hotel)?** Step 5 me `ADMIN_EMAIL` khali chhod do. Demo hotel load hoga, aur
> uska staff password Logs me ek baar dikhega: `Sign in as elena.marsh@example.com with this password: …`.
> Asli hotel ke liye `ADMIN_EMAIL` bharo: khali hotel banega, jisme aap apne rooms daloge.

> **Supabase project bana liya tha?** Ab uski zaroorat nahi. Chaho to Supabase me use delete kar do.

---

## Part 2: Check karo, 2 minute

1. Render page ke upar wala link kholo, jaise `https://hotel-management-system-xxxx.onrender.com`.
   Sign-in page khulega (na khule to address ke aakhir me `/login` likho, ya hotel website ke upar right me
   **Staff login** dabao). Owner, admin aur staff sab isi page se login karte hain: `ADMIN_EMAIL` + `ADMIN_PASSWORD`
   se sign in karo.
2. Left sidebar me neeche **ADMIN → Admin panel** dabao (mobile/tablet par pehle upar-left ☰ menu kholo).
   **Overview** page par **Database** card me dikhega:
   - **Render PostgreSQL · private network**
   - **Tables:** 26 · version 2, **Round trip:** kuch milliseconds, **Set up:** aaj ki date
   - Ek box: **"30 days left on Render’s free database…"**, yaani free database kab band hoga. Ye ginti roz kam hogi;
     aakhri 7 din me box laal ho jata hai.
   - **Laal box "The data is in a temporary file"** dikhe, to database nahi juda: Blueprint se hi banao (Part 1).
3. Pakka karne ke liye: koi room type add karo → Render me **Manual Deploy → Restart service** → website dobara kholo.
   Room type wahi milega. Data database me safe hai.

---

## Part 3: Apna hotel set karo

**Pehle sab kuch chala ke dekhna hai?** Naye (khali) hotel me **Admin panel → Overview → Sample data → Add sample data**
dabao. Kuch second me poora sample hotel ban jaata hai, sab rupee me: Kolkata ka *The Hooghly Residency*, 7 type ke
25 rooms, har role ke 18 staff (aur ek nayi trainee jiska invite link abhi khula hai), alag-alag type ke 50 guests (company wale GSTIN ke saath, family, VIP, walk-in, videshi
guest Form III ke saath, no-show, cancellation) aur 4 hafte ki bookings, check-in/out, payment, refund, GST invoice,
housekeeping aur night audit. Sab kuch normal screens ke code se bana hai, isliye har cheez khol ke edit kar sakte ho.
Staff ka ek hi password **sirf ek baar** dikhta hai, likh lo (bhool gaye to **Staff accounts** me naya password set
kar do). Asli kaam shuru karne se pehle usi card me **Remove sample data** dabao: sample ka sab hat jaata hai.

Apna hotel set karne ke liye **Admin panel** me is order me:
1. **Hotel settings:** naam, city, address, phone, GSTIN, **State** (GST invoice par chhapta hai), check-in/out time,
   aur **Confirmation / Invoice number prefix** me `HTL` / `INV` ki jagah apne hotel ke letters (jaise `GVH`).
   *Website address* khali chhod sakte ho: email ke links Render ka address khud le lete hain. Apna domain lo, tab bharna.
2. **Room types** → **Rooms** → **Rates & extras** → **Booking sources**. Har extra ke saath **GST** chuno: extra bed / late
   check-out = *Same as the room*, airport pickup = *Transport 5%*, decoration / parking = *Other 18%*, ya *No GST*.
   Usi page par **Seasons & weekends**: tyohar ke liye tareekhein (jaise Durga Puja +30%), weekend ke liye din (Fri, Sat
   +10%), ya dono; sab room types ya ek. Har raat apne rate par bikti hai, GST bhi har raat ke rate se lagta hai, aur
   staff form, website aur invoice par raat-raat ka rate dikhta hai. **Admin panel → Rate calendar** me agle 30 din ka
   har room type ka rate aur bache rooms ek table me dikhte hain (weekend, season aur sold-out din alag rang me).
3. **Staff accounts** (sidebar me **ADMIN → Staff accounts**): har staff ka naam, email aur role daalo, password
   **khali chhod do** → **Add account**. Ek **invite link** banta hai (7 din, sirf ek baar chalta hai): **Copy link**
   ya **Send on WhatsApp** dabake staff ko bhej do (email set ho to email bhi chala jaata hai). Staff link kholke apna
   password khud banata hai. Link expire ho gaya ya koi password bhool gaya: **Edit → Send a new invite link /
   Send a password link**. Chaho to purane tareeke se temporary password bhi daal sakte ho.
4. **Website:** guest website shuru me **off** hoti hai. Texts likho aur **on** karo. Guests `https://…onrender.com/hotel` par booking karenge.

**Stay ke dauran charges:** hotel me ruke guest ke booking page par **Add a charge to the bill**: room service, minibar,
laundry, spa, taxi wagairah, apne GST rate ke saath (khana 18% agar koi room ₹7,500 se upar bikta hai, warna 5%;
laundry/spa 18%; taxi 5%; chaho to rate badal sakte ho). Charge total, balance aur check-out me judta hai, aur GST invoice par
SAC code ke saath har rate ka CGST/SGST alag dikhta hai. Galat charge manager **Take off the bill** se hata sakta hai.

**GST return (GSTR-1):** **Admin panel → GST returns** me mahina chuno. Us mahine ki invoices se B2B (company ka GSTIN,
har tax rate ki line), B2C ka total, rate-wise CGST/SGST, HSN/SAC summary aur documents issued (pehla-aakhri invoice
number, cancel wale) ban jaate hain. Har table ki CSV GST offline tool ke column naamon ke saath download hoti hai,
seedha accountant ko de do. GSTR-1 agle mahine ki 11 tarikh tak (QRMP me quarter ke baad 13 tarikh tak).

**Group booking (shaadi, conference):** **Reservations → Groups → New group booking**: group ka naam, contact, dates,
har room type ke kitne rooms, aur chaho to rooming list (har line me ek guest). Har room ki apni booking banti hai. Group
page par: aaj aane wale sab ek click me check-in (jo ready nahi, unka kaaran dikhta hai), poore group ka ek payment (rooms
me baant diya jaata hai) aur poore group ka ek GST invoice company / family ke naam, GSTIN ke saath.

**Guest ko WhatsApp:** har booking page par **WhatsApp the guest** button hai. Dabate hi WhatsApp (app ya WhatsApp Web)
guest ke number aur taiyaar message ke saath khulta hai: booking confirm hone par details + booking dekhne/cancel karne
ka link, hotel me ho to welcome + room number, check-out ke baad thank-you + invoice ka link. Invoice page par
**Send on WhatsApp** se guest ko apni invoice ka link jaata hai, jise wo bina login khol ke PDF save kar sakta hai.
Koi WhatsApp Business account nahi chahiye; message bhejne se pehle aap use badal bhi sakte ho.

---

## Part 4: 30 din se pehle database upgrade karo (data rakhna hai to zaroori)

1. Pehle backup le lo: **Admin → Overview → Download a backup**.
2. Render Dashboard → **hotel-db** kholo → **Upgrade** dabao (ya *Info → Instance Type → Change*) → **0.1c-256mb** chuno.
   Card add karna padega. Data waisa hi rehta hai; website par koi farak nahi padta.
3. Mujhe bata dena: main `render.yaml` me `plan: free` ko `plan: 0.1c-256mb` kar dunga, taaki file aur Render ek
   jaise rahen (warna Blueprint agli baar database ko free plan par lane ki koshish karega).

---

## Roz ke liye zaroori baatein

- **Free website** 15 minute koi visitor na aaye to so jati hai. Agli baar khulne me lagbhag 1 minute lagta hai.
  Data safe rehta hai.
- **Backup:** free database ka koi backup nahi hota. Hafte me ek baar **Admin → Overview → Download a backup** dabao.
  Ek `.db` file download hogi jisme har table hai. Use safe jagah rakho: usme guests ka data hai.
- **Naya code:** jab is branch par update push hoga, Render khud naya version deploy kar dega. Data nahi jayega.
- **Phone / computer par app ki tarah:** staff Frontdesk ko install kar sakte hain, home screen par hotel ke icon ke saath,
  apni alag window me khulta hai. Android (Chrome): menu ⋮ → **Install app**. iPhone (Safari): Share → **Add to Home Screen**.
  Computer (Edge/Chrome): address bar ke right me install icon. **My account** page par steps aur Install button bhi hai.
  Internet na ho to "No connection" page dikhta hai. Guests ka data phone me save nahi hota.

---

## Problem aaye to: Render → service → Events / Logs

| Dikhe | Matlab | Kya karo |
|---|---|---|
| Blueprint banate waqt free database ki limit ka error | Render account me pehle se ek free database hai (ek hi milta hai) | Purana free database delete karo, ya mujhe bolo: main `hotel-db` ko paid plan par kar dunga |
| Build me `package.json` / `npm ci` error | Galat branch chuni (`main`) | Branch `arena/dfe46868-hotel-management-system` chuno |
| `ADMIN_PASSWORD must be 8 to 200 characters long` | Password chhota hai | **hotel-management-system → Environment** → lamba password → **Save and deploy** |
| `did not answer` / `timeout` / `not answering yet` ke baad deploy fail | Database abhi ready nahi tha, ya 30 din baad band ho gaya | **hotel-db** "Available" dikhe to **Manual Deploy → Deploy latest commit**; band ho gaya ho to Part 4 (upgrade) |
| `dpg-… is the private address of a Render database` | Database aur website alag region me | Dono Singapore me hone chahiye (`render.yaml` me pehle se hai); Blueprint se hi banao |
| Website ke Database card me laal box | Database nahi juda | Blueprint se banao (Part 1) |

**Environment** me kuch bhi badlo to save karte waqt **Save and deploy** jaisa option chuno. Na dikhe to save karke
**Manual Deploy → Deploy latest commit** dabao.
