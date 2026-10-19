'use strict';
/*
 * What the sample hotel is made of (db/sample.js turns it into four weeks of hotel life).
 * Day numbers are relative to the day the sample is added: 0 is today, -3 three days ago, 6 next week.
 * Times are hotel time. Money is in rupees. Names, companies, GSTINs, ID and passport numbers are made up;
 * emails use example.com / .net / .org, which can never receive mail.
 */

/* Hotel settings. FILL is only used where the hotel has nothing of its own yet; INDIA always applies. */
const INDIA = {
  country: 'IN', currency_code: 'INR', currency_symbol: '₹', currency_locale: 'en-IN', tax_mode: 'gst_india', tax_label: 'GST', tax_rate: 0,
  timezone: 'Asia/Kolkata', business_date_mode: 'auto', require_grc: true,
};
const FILL = {
  hotel_name: 'The Hooghly Residency',
  hotel_city: 'Kolkata',
  hotel_state: 'West Bengal',
  hotel_address: '14 Park Street, Kolkata, West Bengal 700016',
  hotel_phone: '+91 33 4012 7700',
  hotel_email: 'stay@hooghlyresidency.example.com',
  tax_id: '19AAHCH4821K1Z5',
  default_room_type: 'DLX',
};
const WEBSITE = {
  site_enabled: true,
  site_tagline: 'Calm rooms near Park Street, Bengali breakfasts and a front desk that knows Kolkata.',
  site_intro: 'Twenty-five rooms and suites a short walk from Park Street, breakfast every morning at our Sonar Bangla café, airport pickups on request and a team that will happily plan your day in the city.',
  site_amenities: ['Free high-speed Wi-Fi', 'Breakfast 07:00–10:30', '24-hour front desk', 'Airport pickup on request', 'Free car parking', 'Power backup', 'Doctor on call', 'Laundry service'],
  site_policies: 'Check-in from 14:00, check-out by 11:00. Free cancellation up to 48 hours before arrival unless your rate says otherwise. Every guest needs a photo ID at check-in (passport and visa for foreign nationals). Pets are not allowed.',
};

/* rate: base rate per night when the hotel opened; later: the rate after the price change (CHANGES). */
const ROOM_TYPES = [
  { code: 'STD', name: 'Standard Room', rate: 3200, max: 2, clean: 30, service: 20, bed: 'Queen bed', size: 22, photo: 'classic-queen.jpg',
    description: 'A quiet, bright room with a queen bed, a work desk and a rain shower — all you need for a short city stay.' },
  { code: 'STT', name: 'Standard Twin', rate: 3400, max: 2, clean: 30, service: 20, bed: 'Two single beds', size: 22, photo: 'classic-twin.jpg',
    description: 'Two single beds, a reading chair and room to unpack — good for friends or colleagues travelling together.' },
  { code: 'DLX', name: 'Deluxe Room', rate: 4500, later: 4800, max: 3, clean: 40, service: 25, bed: 'King bed', size: 28, photo: 'deluxe-room.jpg',
    description: 'Our most-booked room: a king bed, a sofa by the window and a view over the rooftops of Park Street.' },
  { code: 'PRM', name: 'Premium Room', rate: 5900, later: 6200, max: 3, clean: 40, service: 25, bed: 'King bed, city view', size: 32, photo: 'premium-room.jpg',
    description: 'A larger corner room on the upper floors with a king bed, a sitting area and a wide city view.' },
  { code: 'FAM', name: 'Family Room', rate: 7200, max: 4, clean: 50, service: 30, bed: 'King bed and two singles', size: 40, photo: 'family-room.jpg',
    description: 'A king bed and two single beds, a mini fridge and a big bathroom, with space for a cot — made for families.' },
  { code: 'EXS', name: 'Executive Suite', rate: 9800, max: 3, clean: 55, service: 30, bed: 'King bed and sitting room', size: 48, photo: 'executive-suite.jpg',
    description: 'A king bedroom with a separate sitting room, a work desk and a pantry — for longer stays and small meetings.' },
  { code: 'PRS', name: 'Presidential Suite', rate: 18500, max: 4, clean: 70, service: 40, bed: 'King bed, living and dining room', size: 85, photo: 'presidential-suite.jpg', online: false,
    description: 'The top-floor suite with a living and dining room, a guest bathroom and a private balcony over the city. On request only.' },
];

/* Room number, floor, type and the room attendant who looks after it. */
const ROOMS = [
  ['101', 1, 'STD', 'ry'], ['102', 1, 'STD', 'ry'], ['103', 1, 'STD', 'ry'], ['104', 1, 'STT', 'ry'], ['105', 1, 'STT', 'ry'], ['106', 1, 'STD', 'ry'],
  ['201', 2, 'DLX', 'sd'], ['202', 2, 'DLX', 'sd'], ['203', 2, 'DLX', 'sd'], ['204', 2, 'DLX', 'sd'], ['205', 2, 'STT', 'sd'], ['206', 2, 'DLX', 'sd'],
  ['301', 3, 'PRM', 'bm'], ['302', 3, 'PRM', 'bm'], ['303', 3, 'PRM', 'bm'], ['304', 3, 'DLX', 'bm'], ['305', 3, 'PRM', 'bm'], ['306', 3, 'FAM', 'bm'],
  ['401', 4, 'FAM', 'ps'], ['402', 4, 'FAM', 'ps'], ['403', 4, 'EXS', 'ps'], ['404', 4, 'EXS', 'ps'], ['405', 4, 'PRM', 'ps'],
  ['501', 5, 'PRS', 'ps'], ['502', 5, 'EXS', 'ps'],
].map(([number, floor, type, attendant]) => ({ number, floor, type, attendant }));

/* Rate plans in Indian hotel terms (EP room only, CP with breakfast, MAP breakfast and dinner).
   adjust: rupees per night, or a percentage. cancel: free-cancellation days (null = non-refundable). */
const PLANS = [
  { code: 'CP', name: 'Bed & breakfast (CP)', adjust: 600, description: 'Breakfast for two at the café, +₹600 per night', cancel: 2, online: true, bookable: true },
  { code: 'MAP', name: 'Breakfast & dinner (MAP)', adjust: 1400, description: 'Breakfast and dinner for two, +₹1,400 per night', cancel: 3, online: true, bookable: true },
  { code: 'ADV', name: 'Advance purchase', adjust: '-10%', description: '10% off, paid in full when booking, non-refundable', cancel: null, online: true, bookable: true },
  { code: 'CORP', name: 'Corporate', adjust: '-15%', description: 'Negotiated company rate, billed to the company', cancel: 1, online: false, bookable: true },
  { code: 'SUMMER', name: 'Summer saver', adjust: '-20%', description: 'Ended on 30 June', cancel: 2, online: false, bookable: false, active: false },
];
/* The empty hotel's own "Best available" plan (room only) is kept; it only gets free cancellation. */
const BAR = { code: 'BAR', name: 'Best available', description: 'Room only (EP), free cancellation until 48 hours before arrival', cancel: 2 };

const EXTRAS = [
  { code: 'airport', name: 'Airport pickup', price: 1500, per: 'stay' },
  { code: 'extra-bed', name: 'Extra bed', price: 1000, per: 'night' },
  { code: 'parking', name: 'Car parking', price: 300, per: 'night' },
  { code: 'late-checkout', name: 'Late checkout till 15:00', price: 1500, per: 'stay' },
  { code: 'decor', name: 'Room decoration (flowers & cake)', price: 2500, per: 'stay' },
];

/* Booking sources. The empty hotel's Walk-in, Phone and Website are kept and put in this order. */
const SOURCES = [
  { name: 'Walk-in', kind: 'walk_in', form: 1 }, { name: 'Phone', kind: 'direct', form: 2 }, { name: 'Website', kind: 'direct', form: 3 },
  { name: 'Email', kind: 'direct', form: 4 }, { name: 'Corporate', kind: 'corporate', form: 5 }, { name: 'Travel agent', kind: 'direct', form: 6 },
  { name: 'MakeMyTrip', kind: 'ota', form: 7 }, { name: 'Booking.com', kind: 'ota', form: 8 }, { name: 'Agoda', kind: 'ota', form: 9 },
  { name: 'Goibibo', kind: 'ota', form: 10 }, { name: 'Expedia', kind: 'ota', form: 11 },
];

/*
 * Staff. start: when they usually sign in. off: weekly day off (0 Sunday … 6 Saturday).
 * Night auditors take alternate nights. Deepak Joshi left the hotel (his account is switched off on day -10).
 */
const STAFF = [
  { key: 'am', name: 'Arjun Mehta', role: 'admin', title: 'General manager', department: 'Management', shift: 'morning', start: '09:45', ip: '192.168.1.10' },
  { key: 'sb', name: 'Sneha Banerjee', role: 'manager', title: 'Front office manager', department: 'Front office', shift: 'morning', start: '08:50', ip: '192.168.1.11' },
  { key: 'vs', name: 'Vikram Singh', role: 'manager', title: 'Duty manager', department: 'Front office', shift: 'evening', start: '14:20', ip: '192.168.1.11' },
  { key: 'pd', name: 'Priya Das', role: 'frontdesk', title: 'Guest service associate', department: 'Front office', shift: 'morning', start: '06:50', off: 3, desk: true, ip: '192.168.1.21' },
  { key: 'rv', name: 'Rahul Verma', role: 'frontdesk', title: 'Guest service associate', department: 'Front office', shift: 'morning', start: '06:53', off: 5, desk: true, ip: '192.168.1.22' },
  { key: 'ag', name: 'Ananya Ghosh', role: 'frontdesk', title: 'Reservations executive', department: 'Reservations', shift: 'morning', start: '09:25', off: 0, ip: '192.168.1.12' },
  { key: 'iq', name: 'Imran Qureshi', role: 'frontdesk', title: 'Guest service associate', department: 'Front office', shift: 'evening', start: '14:50', off: 4, desk: true, ip: '192.168.1.21' },
  { key: 'kn', name: 'Kavita Nair', role: 'frontdesk', title: 'Guest service associate', department: 'Front office', shift: 'evening', start: '14:52', off: 1, desk: true, ip: '192.168.1.22' },
  { key: 'dj', name: 'Deepak Joshi', role: 'frontdesk', title: 'Guest service associate', department: 'Front office', shift: 'evening', start: '14:47', off: 6, desk: true, until: -11, ip: '192.168.1.22' },
  { key: 'sc', name: 'Sourav Chatterjee', role: 'frontdesk', title: 'Night auditor', department: 'Night audit', shift: 'night', start: '22:50', nights: 0, ip: '192.168.1.21' },
  { key: 'fa', name: 'Farhan Ali', role: 'frontdesk', title: 'Night auditor', department: 'Night audit', shift: 'night', start: '22:48', nights: 1, ip: '192.168.1.21' },
  { key: 'mk', name: 'Meena Kumari', role: 'housekeeping', title: 'Executive housekeeper', department: 'Housekeeping', shift: 'morning', start: '06:40', off: 0, area: 'All floors', ip: '192.168.1.45' },
  { key: 'ry', name: 'Ramesh Yadav', role: 'housekeeping', title: 'Room attendant', department: 'Housekeeping', shift: 'morning', start: '06:48', off: 2, area: 'Floor 1', floor: 1, ip: '192.168.1.46' },
  { key: 'sd', name: 'Sunita Devi', role: 'housekeeping', title: 'Room attendant', department: 'Housekeeping', shift: 'morning', start: '06:46', off: 3, area: 'Floor 2', floor: 2, ip: '192.168.1.46' },
  { key: 'bm', name: 'Bikash Mondal', role: 'housekeeping', title: 'Room attendant', department: 'Housekeeping', shift: 'morning', start: '06:51', off: 4, area: 'Floor 3', floor: 3, ip: '192.168.1.47' },
  { key: 'ps', name: 'Pooja Sharma', role: 'housekeeping', title: 'Room attendant', department: 'Housekeeping', shift: 'morning', start: '06:49', off: 5, area: 'Floors 4–5', floor: 4, ip: '192.168.1.47' },
  { key: 'ar', name: 'Abdul Rahman', role: 'housekeeping', title: 'Room attendant (relief)', department: 'Housekeeping', shift: 'morning', start: '06:55', off: 1, area: 'Relief and rush', ip: '192.168.1.48' },
  { key: 'sk', name: 'Santosh Kumar', role: 'housekeeping', title: 'Maintenance technician', department: 'Engineering', shift: 'morning', start: '08:55', off: 0, ip: '192.168.1.49' },
];

/*
 * The 50 guests. id: [ID type, number] for Indian guests; foreign guests have a passport (and a visa unless
 * they are from Nepal or Bhutan). Profile details (city, company, preferences) are typed in by the front desk
 * after the first booking; notes are added later by the person named.
 */
const GUESTS = [
  // Business travellers and their companies
  { key: 'iyer', first: 'Rajesh', last: 'Iyer', email: 'rajesh.iyer@kaverianalytics.example.com', phone: '+91 98450 31762', city: 'Bengaluru, Karnataka',
    dob: '1981-04-12', address: '42, 3rd Cross, Indiranagar 2nd Stage, Bengaluru, Karnataka 560038', id: ['Aadhaar card', '1824 5531 7790'],
    company: 'Kaveri Analytics Pvt Ltd', gstin: '29AAGCK7281M1Z3', corporate: true,
    prefs: { room: ['High floor', 'Away from the lift'], dining: ['South Indian breakfast'], service: ['Invoice in the company’s name'] },
    notes: [[-23, '09:45', 'desk', 'Invoice always in the company’s name — Kaveri Analytics pays by NEFT within 7 days.']] },
  { key: 'kapoor', first: 'Neha', last: 'Kapoor', email: 'neha.kapoor@yamunainfra.example.com', phone: '+91 98110 42873', city: 'New Delhi, Delhi',
    dob: '1987-09-03', address: 'C-18, Defence Colony, New Delhi, Delhi 110024', id: ['PAN card', 'ABHPK4521C'],
    company: 'Yamuna Infra Projects Ltd', gstin: '07AACCY4410P1Z8', corporate: true, prefs: { room: ['Non-smoking', 'Quiet room'], dining: ['Black coffee without sugar'] } },
  { key: 'kulkarni', first: 'Sanjay', last: 'Kulkarni', email: 'sanjay.kulkarni@easterngrid.example.com', phone: '+91 98220 56104', city: 'Pune, Maharashtra',
    dob: '1979-12-21', address: 'Flat 7, Shrinivas Apartments, Kothrud, Pune, Maharashtra 411038', id: ['Aadhaar card', '1490 2276 5513'],
    company: 'Eastern Grid Solutions Pvt Ltd', gstin: '19AABCE6621R1Z2', corporate: true, prefs: { room: ['Ground or first floor'], service: ['Wake-up call at 06:30'] } },
  { key: 'pillai', first: 'Meera', last: 'Pillai', email: 'meera.pillai@konkanpharma.example.com', phone: '+91 98200 71439', city: 'Mumbai, Maharashtra',
    dob: '1985-06-17', address: '1102, Sea Breeze Towers, Powai, Mumbai, Maharashtra 400076', id: ['Driving licence', 'MH03 20080034512'],
    company: 'Konkan Pharma Labs Pvt Ltd', gstin: '27AADCK3390F1Z6', corporate: true, prefs: { comfort: ['Firm pillows'], dining: ['Vegetarian'] } },
  { key: 'rathore', first: 'Vikrant', last: 'Rathore', email: 'vikrant.rathore@deccansoftworks.example.com', phone: '+91 99490 23861', city: 'Hyderabad, Telangana',
    dob: '1983-02-08', address: 'Plot 54, Road No. 10, Jubilee Hills, Hyderabad, Telangana 500033', id: ['Aadhaar card', '1365 9902 4418'],
    company: 'Deccan Softworks LLP', gstin: '36AAKFD5527H1ZK', corporate: true,
    prefs: { comfort: ['Extra hangers', 'Iron and board in the room'], service: ['Housekeeping every other day'] },
    notes: [[-17, '10:15', 'desk', 'Long stay for the Eastern Grid project — the company pays every week by NEFT. Laundry twice a week.']] },
  { key: 'reddy', first: 'Priyanka', last: 'Reddy', email: 'priyanka.reddy@deccansoftworks.example.com', phone: '+91 99080 11245', city: 'Hyderabad, Telangana',
    dob: '1992-11-25', address: 'Flat 302, Lake View Residency, Madhapur, Hyderabad, Telangana 500081', id: ['Aadhaar card', '1572 3384 6620'],
    company: 'Deccan Softworks LLP', gstin: '36AAKFD5527H1ZK', corporate: true },
  { key: 'baruah', first: 'Bhaskar', last: 'Baruah', email: 'bhaskar.baruah@brahmaputratea.example.com', phone: '+91 94350 66721', city: 'Guwahati, Assam',
    dob: '1976-08-30', address: 'House 12, Zoo Road, Guwahati, Assam 781024', id: ['Voter ID', 'XKJ4482915'],
    company: 'Brahmaputra Tea Traders', gstin: '18AAEFB2290C1ZT', corporate: true, prefs: { dining: ['Strong Assam tea'] } },
  { key: 'mueller', first: 'Thomas', last: 'Müller', email: 'thomas.mueller@rhein-maschinenbau.example.com', phone: '+49 711 4609 2213', city: 'Stuttgart, Germany',
    nationality: 'DE', dob: '1974-03-15', address: 'Königstraße 28, 70173 Stuttgart, Germany', passport: 'C4X7R2K9M', visa: ['Business visa', 'BV26DE77412'],
    port: 'Kolkata airport (CCU)', company: 'Rhein Maschinenbau GmbH', corporate: true,
    prefs: { room: ['High floor'], dining: ['Continental breakfast', 'Sparkling water'] } },
  { key: 'watanabe', first: 'Kenji', last: 'Watanabe', email: 'kenji.watanabe@sakura-electronics.example.com', phone: '+81 6 6345 7781', city: 'Osaka, Japan',
    nationality: 'JP', dob: '1980-07-09', address: '2-14-5 Umeda, Kita-ku, Osaka 530-0001, Japan', passport: 'TZ1834562', visa: ['Business visa', 'BV26JP30918'],
    port: 'Kolkata airport (CCU)', company: 'Sakura Electronics KK', corporate: true, prefs: { comfort: ['Slippers', 'Green tea in the room'] } },
  { key: 'menon', first: 'Sunil', last: 'Menon', email: 'sunil.menon@kaverianalytics.example.com', phone: '+91 98860 48127', city: 'Bengaluru, Karnataka',
    dob: '1990-01-19', address: 'Flat 9C, Brigade Gardens, JP Nagar, Bengaluru, Karnataka 560078', id: ['Aadhaar card', '1903 4471 2286'],
    company: 'Kaveri Analytics Pvt Ltd', gstin: '29AAGCK7281M1Z3', corporate: true },
  { key: 'malhotra', first: 'Gaurav', last: 'Malhotra', email: 'gaurav.malhotra@yamunainfra.example.com', phone: '+91 98731 20984', city: 'Gurugram, Haryana',
    dob: '1984-05-27', address: 'Tower 4, Flat 1702, DLF Phase 5, Gurugram, Haryana 122009', id: ['PAN card', 'AQLPM7712K'],
    company: 'Yamuna Infra Projects Ltd', gstin: '07AACCY4410P1Z8', corporate: true, prefs: { room: ['King bed'], service: ['Late checkout when possible'] } },
  { key: 'saxena', first: 'Rajiv', last: 'Saxena', email: 'rajiv.saxena@saxenasteel.example.com', phone: '+91 98100 21456', city: 'New Delhi, Delhi',
    dob: '1966-02-11', address: '7, Prithviraj Road, New Delhi, Delhi 110011', id: ['Passport', 'M7731026'],
    company: 'Saxena Steel & Power Ltd', gstin: '07AAFCS5520N1Z9', vip: true, corporate: true,
    prefs: { room: ['Suite on the top floor'], dining: ['Filter coffee at 06:30'] } },

  // Holidays, families and celebrations
  { key: 'mitra', first: 'Rohan', last: 'Mitra', email: 'rohan.mitra@example.net', phone: '+91 98201 55730', city: 'Mumbai, Maharashtra',
    dob: '1986-02-14', address: '502, Palm Court, Bandra West, Mumbai, Maharashtra 400050', id: ['Aadhaar card', '1647 2039 8851'], prefs: { dining: ['Bengali sweets'] } },
  { key: 'srinivasan', first: 'Kavya', last: 'Srinivasan', email: 'kavya.srinivasan@example.net', phone: '+91 99000 31876', city: 'Bengaluru, Karnataka',
    dob: '1995-10-02', address: '88, 5th Block, Koramangala, Bengaluru, Karnataka 560095', id: ['Aadhaar card', '1218 6640 3375'], prefs: { room: ['Room near the lift'] } },
  { key: 'patel', first: 'Suresh', last: 'Patel', email: 'suresh.patel@example.net', phone: '+91 98250 61948', city: 'Ahmedabad, Gujarat',
    dob: '1982-12-05', address: '14, Shanti Kunj Society, Satellite, Ahmedabad, Gujarat 380015', id: ['Aadhaar card', '1755 8812 0943'],
    prefs: { dining: ['Jain food (no onion or garlic)'], comfort: ['Extra pillows'] } },
  { key: 'gill', first: 'Harpreet', last: 'Gill', email: 'harpreet.gill@example.net', phone: '+91 98140 22719', city: 'Amritsar, Punjab',
    dob: '1988-04-22', address: '31, Ranjit Avenue, Amritsar, Punjab 143001', id: ['Driving licence', 'PB02 20100056712'], prefs: { dining: ['Punjabi breakfast', 'Masala chai'] } },
  { key: 'venkatesh', first: 'Lakshmi', last: 'Venkatesh', email: 'lakshmi.venkatesh@example.net', phone: '+91 94440 18235', city: 'Chennai, Tamil Nadu',
    dob: '1955-08-11', address: '7, Kasturi Ranga Road, Alwarpet, Chennai, Tamil Nadu 600018', id: ['Aadhaar card', '1336 7021 5594'],
    prefs: { room: ['Low floor near the lift'], comfort: ['Extra blanket'], service: ['Wheelchair at the entrance'] },
    notes: [[-7, '12:50', 'desk', 'Uses a walker — arrange a wheelchair from the car and help with the luggage.']] },
  { key: 'deshmukh', first: 'Aditya', last: 'Deshmukh', email: 'aditya.deshmukh@example.net', phone: '+91 97660 40518', city: 'Pune, Maharashtra',
    dob: '1994-06-30', address: 'B-204, Green Meadows, Baner, Pune, Maharashtra 411045', id: ['Aadhaar card', '1489 3302 7716'] },
  { key: 'sen', first: 'Ishita', last: 'Sen', email: 'ishita.sen@example.net', phone: '+91 98310 27461', city: 'Kolkata, West Bengal',
    dob: '1991-03-08', address: '23/1, Hindusthan Park, Kolkata, West Bengal 700029', id: ['Aadhaar card', '1922 0045 6628'] },
  { key: 'arif', first: 'Mohammed', last: 'Arif', email: 'mohammed.arif@example.net', phone: '+91 94150 33872', city: 'Lucknow, Uttar Pradesh',
    dob: '1989-09-14', address: '12, Ashok Marg, Hazratganj, Lucknow, Uttar Pradesh 226001', id: ['Voter ID', 'UPL3381204'] },
  { key: 'sharma', first: 'Ritika', last: 'Sharma', email: 'ritika.sharma@example.net', phone: '+91 98290 50617', city: 'Jaipur, Rajasthan',
    dob: '1996-12-12', address: '45, Malviya Nagar, Jaipur, Rajasthan 302017', id: ['Aadhaar card', '1810 7743 2209'] },
  { key: 'mukherjee', first: 'Debashish', last: 'Mukherjee', email: 'debashish.mukherjee@example.net', phone: '+91 94340 71128', city: 'Siliguri, West Bengal',
    dob: '1968-01-26', address: '9, Hakimpara Main Road, Siliguri, West Bengal 734001', id: ['Aadhaar card', '1271 5508 3364'], prefs: { room: ['First floor'] },
    notes: [[-22, '10:05', 'desk', 'Comes every few weeks for his mother’s check-ups at the hospital — give him the same room if it is free.']] },
  { key: 'savitri', first: 'Savitri', last: 'Agarwal', email: 'savitri.agarwal@example.net', phone: '+91 98290 12364', city: 'Jaipur, Rajasthan',
    notes: [[-5, '11:25', 'res', 'Agarwal–Jalan wedding block with Mahesh Agarwal and Kiran Goenka. The family pays the balance at check-out.']] },
  { key: 'mahesh', first: 'Mahesh', last: 'Agarwal', email: 'mahesh.agarwal@example.net', phone: '+91 98291 77420', city: 'Jaipur, Rajasthan' },
  { key: 'goenka', first: 'Kiran', last: 'Goenka', email: 'kiran.goenka@example.net', phone: '+91 98100 63295', city: 'New Delhi, Delhi' },
  { key: 'siddiqui', first: 'Ayesha', last: 'Siddiqui', email: 'ayesha.siddiqui@example.net', phone: '+91 98480 52716', city: 'Hyderabad, Telangana',
    dob: '1993-08-21', address: '8-2-293, Road No. 3, Banjara Hills, Hyderabad, Telangana 500034', id: ['Aadhaar card', '1528 7713 0046'] },
  { key: 'khanna', first: 'Nikhil', last: 'Khanna', email: 'nikhil.khanna@example.net', phone: '+91 98112 40875', city: 'New Delhi, Delhi', nationality: 'IN' },
  { key: 'bhatt', first: 'Vivek', last: 'Bhatt', email: 'vivek.bhatt@example.net', phone: '+91 94120 37719', city: 'Dehradun, Uttarakhand',
    notes: [[-5, '09:35', 'mgr', 'No-show on {-6} (Booking.com). Ask for a card guarantee on the next booking.']] },
  { key: 'basu', first: 'Shreya', last: 'Basu', email: 'shreya.basu@example.net', phone: '+91 98300 44571', city: 'Kolkata, West Bengal' },
  { key: 'bajwa', first: 'Karan', last: 'Bajwa', email: 'karan.bajwa@example.net', phone: '+91 98140 90612', city: 'Chandigarh',
    dob: '1990-11-03', address: 'House 1182, Sector 21-B, Chandigarh 160022', id: ['Driving licence', 'CH01 20120004471'] },
  { key: 'tiwari', first: 'Manish', last: 'Tiwari', email: 'manish.tiwari@example.net', phone: '+91 94310 26637', city: 'Patna, Bihar',
    dob: '1984-04-04', address: '17, Boring Road, Patna, Bihar 800001', id: ['Aadhaar card', '1563 2290 8817'],
    notes: [[-20, '10:40', 'desk', 'Father is in the hospital nearby — he may extend; offer the weekly rate if he asks.']] },
  { key: 'hegde', first: 'Gayatri', last: 'Hegde', email: 'gayatri.hegde@example.net', phone: '+91 94480 51233', city: 'Mangaluru, Karnataka' },
  { key: 'dsouza', first: 'Joseph', last: 'D’Souza', email: 'joseph.dsouza@example.net', phone: '+91 98221 66490', city: 'Panaji, Goa', nationality: 'IN',
    dob: '1978-12-24', address: '3, Rua de Ourém, Fontainhas, Panaji, Goa 403001', id: ['Aadhaar card', '1398 4410 7752'], prefs: { dining: ['Fish curry and rice'] } },
  { key: 'das', first: 'Pranab', last: 'Das', email: 'pranab.das@example.net', phone: '+91 94370 22156', city: 'Bhubaneswar, Odisha',
    dob: '1972-06-06', address: 'Plot 221, Saheed Nagar, Bhubaneswar, Odisha 751007', id: ['Voter ID', 'ODX1192837'] },
  { key: 'gokhale', first: 'Sameer', last: 'Gokhale', email: 'sameer.gokhale@example.net', phone: '+91 98230 70345', city: 'Nagpur, Maharashtra',
    dob: '1988-01-15', address: '56, Dharampeth, Nagpur, Maharashtra 440010', id: ['Aadhaar card', '1652 3378 4401'] },
  { key: 'sarkar', first: 'Malini', last: 'Sarkar', email: 'malini.sarkar@example.net', phone: '+91 98201 99012', city: 'Mumbai, Maharashtra', vip: true,
    dob: '1980-09-28', address: '18th Floor, Ocean Heights, Worli, Mumbai, Maharashtra 400018', id: ['Passport', 'Z4417729'],
    prefs: { comfort: ['Feather-free pillows'], dining: ['Vegan'], service: ['No calls put through without checking with her'] },
    notes: [[-10, '15:30', 'mgr', 'Press may call — never confirm she is staying with us. Her manager Ritu (+91 98200 44512) handles all requests.']] },
  { key: 'bhattacharya', first: 'Anupam', last: 'Bhattacharya', email: 'anupam.bhattacharya@example.net', phone: '+91 98111 30528', city: 'New Delhi, Delhi', vip: true,
    dob: '1970-07-01', address: 'B-7, Hauz Khas Enclave, New Delhi, Delhi 110016', id: ['Aadhaar card', '1734 9920 1185'], prefs: { dining: ['Diabetic-friendly meals'] } },
  { key: 'krishnan', first: 'Geeta', last: 'Krishnan', email: 'geeta.krishnan@example.net', phone: '+91 94441 77302', city: 'Chennai, Tamil Nadu',
    dob: '1964-03-29', address: '22, 2nd Main Road, Besant Nagar, Chennai, Tamil Nadu 600090', id: ['Aadhaar card', '1287 6654 0391'] },
  { key: 'pandey', first: 'Abhishek', last: 'Pandey', email: 'abhishek.pandey@example.net', phone: '+91 94150 88213', city: 'Varanasi, Uttar Pradesh',
    dob: '1987-03-16', address: 'B 21/115, Kamachha, Varanasi, Uttar Pradesh 221010', id: ['Aadhaar card', '1611 4092 3378'], prefs: { room: ['Quiet room away from the road'] } },
  { key: 'shah', first: 'Tanvi', last: 'Shah', email: 'tanvi.shah@example.net', phone: '+91 98250 33197', city: 'Surat, Gujarat',
    dob: '1991-07-07', address: '9, Ghod Dod Road, Surat, Gujarat 395007', id: ['Aadhaar card', '1449 0218 6673'],
    notes: [[-4, '22:20', 'desk', 'No hot water in 302 on her first night — moved her to {room} and offered a complimentary dinner. Apologise again if she comes back.']] },

  // From abroad (Form III for the FRRO, except Nepal and Bhutan)
  { key: 'dorji', first: 'Tenzin', last: 'Dorji', email: 'tenzin.dorji@example.net', phone: '+975 17 61 2045', city: 'Thimphu, Bhutan',
    nationality: 'BT', dob: '1985-05-05', address: 'Norzin Lam, Thimphu, Bhutan', passport: 'BP0457812' },
  { key: 'shrestha', first: 'Bishal', last: 'Shrestha', email: 'bishal.shrestha@example.net', phone: '+977 98510 64213', city: 'Kathmandu, Nepal',
    nationality: 'NP', dob: '1990-02-17', address: 'New Baneshwor, Kathmandu, Nepal', passport: 'PA0912345' },
  { key: 'clarke', first: 'Emily', last: 'Clarke', email: 'emily.clarke@example.org', phone: '+44 7700 900417', city: 'London, United Kingdom',
    nationality: 'GB', dob: '1993-05-19', address: '27 Albert Street, London NW1 7LU, United Kingdom', passport: '533401372', visa: ['e-Visa', 'EV26GB4471209'],
    port: 'Delhi airport (DEL)', prefs: { dining: ['Vegetarian'] } },
  { key: 'johnson', first: 'Michael', last: 'Johnson', email: 'michael.johnson@example.com', phone: '+1 415 555 0142', city: 'San Francisco, United States',
    nationality: 'US', dob: '1979-11-30', address: '1450 Valencia Street, San Francisco, CA 94110, USA', passport: '561384920', visa: ['e-Visa', 'EV26US8830142'],
    port: 'Delhi airport (DEL)' },
  { key: 'martin', first: 'Sophie', last: 'Martin', email: 'sophie.martin@example.org', phone: '+33 6 45 21 88 30', city: 'Lyon, France',
    nationality: 'FR', dob: '1990-04-03', address: '12 Rue Mercière, 69002 Lyon, France', passport: '18AV12345', visa: ['e-Visa', 'EV26FR2093374'],
    port: 'Kolkata airport (CCU)' },
  { key: 'islam', first: 'Rafiqul', last: 'Islam', email: 'rafiqul.islam@example.net', phone: '+880 1712 345678', city: 'Dhaka, Bangladesh',
    nationality: 'BD', dob: '1975-01-20', address: 'House 21, Road 7, Dhanmondi, Dhaka 1205, Bangladesh', passport: 'EB0123456', visa: ['Medical visa', 'MV26BD5520193'],
    port: 'Petrapole land port',
    notes: [[-11, '10:35', 'desk', 'Here for his father’s treatment — hospital shuttle at 08:00 every day.']] },
  { key: 'jahan', first: 'Nusrat', last: 'Jahan', email: 'nusrat.jahan@example.net', phone: '+880 1819 223344', city: 'Chattogram, Bangladesh',
    nationality: 'BD', dob: '1987-06-25', address: 'Agrabad C/A, Chattogram 4100, Bangladesh', passport: 'EC0987654', visa: ['Medical visa', 'MV26BD6612078'],
    port: 'Kolkata airport (CCU)' },
  { key: 'obrien', first: 'Liam', last: 'O’Brien', email: 'liam.obrien@example.com', phone: '+61 491 570 158', city: 'Sydney, Australia', nationality: 'AU' },
  { key: 'almansoori', first: 'Ahmed', last: 'Al Mansoori', email: 'ahmed.almansoori@example.com', phone: '+971 50 123 4567', city: 'Dubai, United Arab Emirates',
    nationality: 'AE', dob: '1983-10-17', address: 'Villa 8, Al Wasl Road, Jumeirah, Dubai, United Arab Emirates', passport: 'N1234567', visa: ['Business visa', 'BV26AE3310957'],
    port: 'Kolkata airport (CCU)', prefs: { dining: ['Halal meals'] } },
  { key: 'kowalska', first: 'Anna', last: 'Kowalska', email: 'anna.kowalska@example.org', phone: '+48 512 345 678', city: 'Kraków, Poland' },
];

/*
 * Stays: g guest, a arrival day, n nights, type, plan, src source, ad/ch adults/children.
 * book [day, time, who]: who is a staff key, or 'res' (reservations), 'desk' (front desk on duty), 'mgr', 'web' (guest online).
 * in / out: check-in and check-out times on the arrival / departure day.
 * pay [[day, time, who, amount, method, reference]]: amount 'all', 'night', 'half', a number of nights {n}, or rupees.
 * settle: how the rest is paid at check-out ([method, reference] records it as a payment first).
 * inv: 'guest', 'company' or ['agent', name, gstin]. f3: Form III filing [day, time]; false leaves it to do.
 */
const STAYS = [
  // ---- Kaveri Analytics: Rajesh Iyer, a regular
  { g: 'iyer', a: -26, n: 3, type: 'DLX', plan: 'CORP', src: 'Corporate', book: [-31, '11:20', 'res'], in: '15:10', out: '09:30',
    settle: ['Bank transfer', 'Kaveri Analytics · PO KA-2291'], inv: 'company' },
  { g: 'iyer', a: -12, n: 2, type: 'DLX', plan: 'CORP', src: 'Corporate', book: [-16, '10:05', 'res'], edit: { at: [-16, '10:08', 'res'], eta: '20:30', tags: ['late'] },
    in: '20:50', out: '08:45', settle: ['Bank transfer', 'Kaveri Analytics · PO KA-2347'], inv: 'company',
    charges: [[0, '21:45', 'fnb', 'Dinner from room service', 980]] },
  { g: 'iyer', a: -2, n: 4, type: 'DLX', plan: 'CORP', src: 'Corporate', book: [-7, '16:40', 'res'], in: '13:20',
    charges: [[0, '21:40', 'fnb', 'Dinner from room service: 2 veg thalis', 760], [1, '08:10', 'laundry', 'Laundry: 4 shirts washed and pressed', 320]] },
  { g: 'iyer', a: -19, n: 2, type: 'DLX', plan: 'CORP', src: 'Corporate', book: [-23, '10:30', 'res'], in: '14:40', out: '09:20',
    settle: ['Bank transfer', 'Kaveri Analytics · PO KA-2318'], inv: 'company' },
  { g: 'menon', a: -26, n: 2, type: 'DLX', plan: 'CORP', src: 'Corporate', book: [-29, '11:40', 'res'], in: '16:30', out: '09:10',
    settle: ['Bank transfer', 'Kaveri Analytics · PO KA-2285'], inv: 'company' },
  { g: 'menon', a: 3, n: 3, type: 'DLX', plan: 'CORP', src: 'Corporate', book: [-5, '10:10', 'res'] },

  // ---- Yamuna Infra
  { g: 'kapoor', a: -21, n: 3, type: 'PRM', plan: 'CORP', src: 'Corporate', book: [-25, '12:30', 'res'], in: '14:05', out: '10:00',
    settle: ['Bank transfer', 'Yamuna Infra · PO YI-0812'], inv: 'company' },
  { g: 'kapoor', a: -9, n: 3, type: 'PRM', plan: 'CORP', src: 'Corporate', book: [-14, '15:15', 'res'], in: '14:30', out: '10:10',
    settle: ['Bank transfer', 'Yamuna Infra · PO YI-0870'], inv: 'guest', reissue: 25,
    charges: [[1, '21:15', 'fnb', 'Dinner at the restaurant: 2 guests', 2200], [2, '22:40', 'minibar', 'Minibar: snacks and soft drinks', 380]] },
  { g: 'kapoor', a: 6, n: 2, type: 'PRM', plan: 'CORP', src: 'Corporate', book: [-2, '11:45', 'res'] },
  { g: 'malhotra', a: -10, n: 2, type: 'EXS', plan: 'CORP', src: 'Corporate', book: [-13, '16:20', 'res'], in: '14:55', out: '10:05',
    settle: ['Bank transfer', 'Yamuna Infra · PO YI-0861'], inv: 'company' },
  { g: 'malhotra', a: 20, n: 2, type: 'EXS', plan: 'CORP', src: 'Corporate', book: [-2, '17:05', 'res'], tentative: true, notes: 'Waiting for the purchase order from Yamuna Infra — hold until {5}.' },

  // ---- Eastern Grid (billed to their Kolkata office, so CGST + SGST)
  { g: 'kulkarni', a: -27, n: 3, type: 'STD', plan: 'CORP', src: 'Corporate', book: [-32, '14:10', 'res'], in: '15:05', out: '09:10',
    settle: ['Bank transfer', 'Eastern Grid · PO EG-5521'], inv: 'company' },
  { g: 'kulkarni', a: -20, n: 4, type: 'STD', plan: 'CORP', src: 'Corporate', book: [-25, '10:40', 'res'], edit: { at: [-25, '10:43', 'res'], eta: '12:30', tags: ['early'] },
    in: '12:40', out: '09:15', settle: ['Bank transfer', 'Eastern Grid · PO EG-5590'], inv: 'company' },
  { g: 'kulkarni', a: -13, n: 3, type: 'STD', plan: 'CORP', src: 'Corporate', book: [-17, '11:15', 'res'], in: '15:35', out: '09:05',
    settle: ['Bank transfer', 'Eastern Grid · PO EG-5637'], inv: 'company' },
  { g: 'kulkarni', a: -3, n: 5, type: 'STD', plan: 'CORP', src: 'Corporate', book: [-8, '11:05', 'res'], in: '16:05' },

  // ---- Konkan Pharma
  { g: 'pillai', a: -15, n: 3, type: 'DLX', plan: 'CORP', src: 'Corporate', book: [-19, '09:50', 'res'], in: '18:10', out: '07:45',
    settle: ['Bank transfer', 'Konkan Pharma · PO KP-1188'], inv: 'company' },
  { g: 'pillai', a: -22, n: 2, type: 'DLX', plan: 'CORP', src: 'Corporate', book: [-26, '12:10', 'res'], in: '17:50', out: '08:10',
    settle: ['Bank transfer', 'Konkan Pharma · PO KP-1150'], inv: 'company' },
  { g: 'pillai', a: 0, n: 3, type: 'DLX', plan: 'CORP', src: 'Corporate', book: [-4, '12:20', 'res'], edit: { at: [-1, '11:10', 'res'], eta: '18:30' }, in: '18:40' },

  // ---- Deccan Softworks: a 24-night project stay paid weekly, and a colleague
  { g: 'rathore', a: -18, n: 24, type: 'STD', plan: 'CORP', src: 'Corporate', book: [-22, '15:30', 'res'], edit: { at: [-22, '15:33', 'res'], eta: '11:30', tags: ['early'] },
    in: '11:50', pay: [[-11, '11:10', 'desk', { n: 7 }, 'Bank transfer', 'Deccan Softworks NEFT · week 1'], [-4, '11:20', 'desk', { n: 7 }, 'Bank transfer', 'Deccan Softworks NEFT · week 2']],
    charges: [[3, '19:30', 'laundry', 'Laundry: weekly bag', 650], [10, '19:45', 'laundry', 'Laundry: weekly bag', 700], [16, '20:15', 'fnb', 'Room service: dinner', 540]] },
  { g: 'reddy', a: -18, n: 3, type: 'STD', plan: 'CORP', src: 'Corporate', book: [-22, '15:36', 'res'], in: '11:55', out: '09:00',
    settle: ['Bank transfer', 'Deccan Softworks · PO DS-3307'], inv: 'company' },
  { g: 'reddy', a: -8, n: 4, type: 'STD', plan: 'CORP', src: 'Corporate', book: [-12, '10:15', 'res'], in: '14:25', out: '09:20',
    settle: ['Bank transfer', 'Deccan Softworks · PO DS-3362'], inv: 'company' },

  // ---- Brahmaputra Tea
  { g: 'baruah', a: -24, n: 2, type: 'PRM', plan: 'CORP', src: 'Corporate', book: [-29, '13:00', 'res'], in: '15:20', out: '10:40',
    settle: ['Bank transfer', 'Brahmaputra Tea · PO BT-441'], inv: 'company' },
  { g: 'baruah', a: -6, n: 2, type: 'PRM', plan: 'CORP', src: 'Corporate', book: [-9, '12:45', 'res'], in: '15:40', out: '10:30',
    settle: ['Bank transfer', 'Brahmaputra Tea · PO BT-468'], inv: 'company' },
  { g: 'baruah', a: -15, n: 2, type: 'PRM', plan: 'CORP', src: 'Corporate', book: [-18, '15:05', 'res'], in: '16:10', out: '10:15',
    settle: ['Bank transfer', 'Brahmaputra Tea · PO BT-452'], inv: 'company' },
  { g: 'baruah', a: 18, n: 2, type: 'PRM', plan: 'CORP', src: 'Corporate', book: [-1, '14:30', 'res'] },

  // ---- Rhein Maschinenbau (Germany) and Sakura Electronics (Japan)
  { g: 'mueller', a: -25, n: 5, type: 'PRM', plan: 'CORP', src: 'Corporate', extras: ['airport'], book: [-30, '17:20', 'res'],
    edit: { at: [-30, '17:24', 'res'], eta: '21:30', tags: ['late'] }, in: '21:40', f3: { arr: [-24, '10:05'], dep: [-20, '12:15'] }, out: '08:30', settle: 'Card', inv: 'company',
    grc: { from: 'Frankfurt', to: 'Jamshedpur' } },
  { g: 'mueller', a: -4, n: 7, type: 'PRM', plan: 'CORP', src: 'Corporate', extras: ['airport'], book: [-12, '16:05', 'res'],
    edit: { at: [-12, '16:09', 'res'], eta: '21:15', tags: ['late'] }, in: '21:30', f3: { arr: [-3, '09:40'] }, grc: { from: 'Frankfurt', to: 'Stuttgart' },
    charges: [[1, '22:10', 'minibar', 'Minibar: 2 beers, 1 juice', 690], [2, '17:30', 'spa', 'Spa: 60-minute aromatherapy massage', 3200]] },
  { g: 'watanabe', a: -22, n: 4, type: 'PRM', plan: 'BAR', src: 'Phone', book: [-27, '10:30', 'res'], in: '14:50', f3: { arr: [-21, '09:55'], dep: [-18, '13:40'] },
    out: '10:20', settle: 'Card', inv: 'company', grc: { from: 'Bangkok', to: 'Osaka' } },
  { g: 'watanabe', a: 12, n: 4, type: 'PRM', plan: 'CORP', src: 'Corporate', book: [-3, '09:45', 'res'] },

  // ---- VIPs
  { g: 'saxena', a: -23, n: 2, type: 'EXS', plan: 'BAR', src: 'Phone', book: [-25, '11:00', 'mgr'], in: '13:00', out: '10:00', settle: 'Card', inv: 'company' },
  { g: 'saxena', a: -14, n: 2, type: 'EXS', plan: 'BAR', src: 'Phone', book: [-17, '10:45', 'mgr'], in: '12:55', out: '09:50', settle: 'Card', inv: 'company' },
  { g: 'saxena', a: -6, n: 2, type: 'EXS', plan: 'BAR', src: 'Phone', book: [-8, '10:15', 'mgr'], in: '13:10', out: '09:40', settle: 'Card', inv: 'company' },
  { g: 'saxena', a: 2, n: 2, type: 'PRS', plan: 'BAR', src: 'Phone', book: [-3, '10:20', 'mgr'] },
  { g: 'sarkar', a: -1, n: 3, type: 'PRS', plan: 'MAP', src: 'Phone', extras: ['airport'], book: [-10, '15:20', 'mgr'],
    req: 'Vegan meals and feather-free pillows, please. Keep the stay confidential.', edit: { at: [-2, '16:00', 'mgr'], eta: '12:00', tags: ['early'] }, in: '12:15', inBy: 'mgr' },
  { g: 'bhattacharya', a: 0, n: 2, type: 'EXS', plan: 'CP', src: 'Phone', extras: ['airport'], book: [-6, '12:35', 'res'],
    req: 'Speaking at the cardiology conference at Science City on both days.', edit: { at: [-1, '17:30', 'res'], eta: '16:00' }, in: '16:10',
    grc: { purpose: 'Conference or event' } },

  // ---- Couples, families and friends
  { g: 'mitra', a: 0, n: 2, type: 'EXS', plan: 'MAP', src: 'Website', extras: ['decor', 'airport'], book: [-11, '22:14', 'web'],
    req: 'It’s our 10th wedding anniversary — could you arrange a small cake in the room? We land at 1:30 pm.',
    edit: { at: [-1, '11:30', 'res'], eta: '14:30', tags: ['anniversary'] }, in: '14:40' },
  { g: 'deshmukh', a: -3, n: 4, type: 'PRM', plan: 'MAP', src: 'Website', extras: ['decor'], book: [-21, '23:05', 'web'],
    req: 'We’re on our honeymoon — flowers in the room would be lovely!', in: '15:00', pay: [[-3, '15:04', 'desk', 'half', 'Card', 'Card ending 4417']],
    charges: [[1, '17:00', 'spa', 'Spa: couple’s massage, 90 minutes', 4800]] },
  { g: 'patel', a: -1, n: 3, type: 'FAM', plan: 'CP', src: 'Phone', ch: 2, extras: ['extra-bed'], book: [-20, '12:05', 'res'],
    req: 'Travelling with our two children (6 and 9). Jain food please — no onion, no garlic.',
    pay: [[-20, '12:10', 'res', 'night', 'UPI', 'UPI ref 4127 8890 3321']], in: '13:30' },
  { g: 'patel', a: -1, n: 3, type: 'DLX', plan: 'CP', src: 'Phone', book: [-20, '12:08', 'res'], req: 'For my parents — a low floor, please.', room: '201', in: '13:35' },
  { g: 'gill', a: -14, n: 3, type: 'FAM', plan: 'CP', src: 'Booking.com', ch: 1, extras: ['parking'], book: [-23, '10:20', 'res'], in: '14:20', out: '10:50', settle: 'Card', inv: 'guest' },
  { g: 'gill', a: 25, n: 3, type: 'FAM', plan: 'CP', src: 'Booking.com', ch: 1, book: [-1, '10:35', 'res'] },
  { g: 'venkatesh', a: -7, n: 6, type: 'DLX', plan: 'CP', src: 'Phone', room: '201', book: [-15, '11:15', 'res'],
    pay: [[-15, '11:20', 'res', 'night', 'UPI', 'UPI ref 6021 4478 9910']], edit: { at: [-8, '10:00', 'res'], eta: '12:30', tags: ['early'] },
    in: '12:35', out: '10:30', settle: 'Card', inv: 'guest' },
  { g: 'sen', a: -21, n: 1, type: 'EXS', plan: 'BAR', src: 'Walk-in', book: [-21, '17:05', 'desk'],
    pay: [[-21, '17:10', 'desk', 'all', 'UPI', 'UPI ref 2290 6614 0083']], in: '17:15', out: '11:20', inv: 'guest', grc: { purpose: 'Leisure', from: 'Kolkata' } },
  { g: 'sen', a: -7, n: 1, type: 'EXS', plan: 'BAR', src: 'Walk-in', extras: ['parking'], book: [-7, '16:20', 'desk'],
    pay: [[-7, '16:26', 'desk', 'all', 'UPI', 'UPI ref 3301 7745 2208']], in: '16:30', out: '11:00', inv: 'guest', grc: { purpose: 'Leisure', from: 'Kolkata' } },
  { g: 'arif', a: -16, n: 2, type: 'STT', plan: 'BAR', src: 'Goibibo', book: [-20, '11:30', 'res'],
    pay: [[-20, '11:33', 'res', 'all', 'Bank transfer', 'Goibibo prepaid · GO-2210983']], in: '14:10', out: '10:05', inv: 'guest' },
  { g: 'arif', a: -2, n: 2, type: 'STT', plan: 'BAR', src: 'Phone', extras: ['late-checkout'], book: [-4, '18:20', 'desk'], in: '15:45', out: '13:00', settle: 'Cash', inv: 'guest' },
  { g: 'sharma', a: 0, n: 2, type: 'DLX', plan: 'BAR', src: 'Agoda', ad: 3, book: [-9, '10:50', 'res'],
    pay: [[-9, '10:53', 'res', 'all', 'Bank transfer', 'Agoda prepaid · AG-77120934']], edit: { at: [-1, '16:10', 'res'], eta: '13:30' }, in: '13:40' },
  { g: 'srinivasan', a: -10, n: 2, type: 'STD', plan: 'BAR', src: 'MakeMyTrip', ad: 1, book: [-17, '13:25', 'res'],
    pay: [[-17, '13:28', 'res', 'all', 'Bank transfer', 'MakeMyTrip prepaid · MMT-6610274']], in: '13:10', out: '10:40', inv: 'guest' },
  { g: 'srinivasan', a: -3, n: 3, type: 'STD', plan: 'BAR', src: 'MakeMyTrip', ad: 1, book: [-6, '19:50', 'desk'],
    pay: [[-6, '19:53', 'desk', 'all', 'Bank transfer', 'MakeMyTrip prepaid · MMT-6648213']], in: '15:20', out: '10:15', inv: 'guest' },
  { g: 'savitri', a: 9, n: 3, type: 'DLX', plan: 'CP', src: 'Phone', book: [-5, '11:00', 'res'], req: 'Agarwal–Jalan wedding — three rooms for the family, close together please.',
    pay: [[-5, '11:12', 'res', 'night', 'Bank transfer', 'Agarwal–Jalan wedding advance · NEFT']] },
  { g: 'mahesh', a: 9, n: 3, type: 'DLX', plan: 'CP', src: 'Phone', book: [-5, '11:04', 'res'], req: 'Agarwal–Jalan wedding block.',
    pay: [[-5, '11:14', 'res', 'night', 'Bank transfer', 'Agarwal–Jalan wedding advance · NEFT']] },
  { g: 'goenka', a: 9, n: 3, type: 'FAM', plan: 'CP', src: 'Phone', ch: 2, book: [-5, '11:08', 'res'], req: 'Agarwal–Jalan wedding block.',
    pay: [[-5, '11:16', 'res', 'night', 'Bank transfer', 'Agarwal–Jalan wedding advance · NEFT']] },
  { g: 'siddiqui', a: -24, n: 2, type: 'PRM', plan: 'BAR', src: 'Website', book: [-30, '21:35', 'web'], in: '15:05', out: '10:35', settle: 'Card', inv: 'guest' },
  { g: 'siddiqui', a: 4, n: 2, type: 'PRM', plan: 'ADV', src: 'Phone', book: [-8, '12:40', 'res'], pay: [[-8, '12:44', 'res', 'all', 'Card', 'Advance purchase · card ending 2290']] },
  { g: 'hegde', a: 15, n: 3, type: 'DLX', plan: 'CP', src: 'MakeMyTrip', book: [-3, '12:15', 'res'], pay: [[-3, '12:18', 'res', 'all', 'Bank transfer', 'MakeMyTrip prepaid · MMT-6702291']] },
  { g: 'dsouza', a: -19, n: 3, type: 'PRM', plan: 'BAR', src: 'Website', book: [-26, '20:45', 'web'], in: '15:30', out: '11:00', settle: 'Card', inv: 'guest' },
  { g: 'dsouza', a: 30, n: 2, type: 'PRM', plan: 'CP', src: 'Website', book: [-2, '21:10', 'web'] },
  { g: 'krishnan', a: -12, n: 4, type: 'DLX', plan: 'CP', src: 'Travel agent', book: [-20, '14:20', 'res'], req: 'Booked by Bengal Holidays (travel agent) — voucher BH-2291.',
    pay: [[-20, '14:25', 'res', 'all', 'Bank transfer', 'Bengal Holidays voucher BH-2291']], in: '14:00', out: '10:30', inv: ['agent', 'Bengal Holidays Pvt Ltd', '19AAKCB7710E1Z4'] },
  { g: 'pandey', a: -10, n: 2, type: 'STD', plan: 'BAR', src: 'Email', book: [-12, '10:10', 'res'], in: '13:30', out: '09:45', settle: 'UPI', inv: 'guest' },
  { g: 'pandey', a: 1, n: 2, type: 'STD', plan: 'BAR', src: 'Email', book: [-2, '10:25', 'res'], req: 'Arriving by the Rajdhani Express around 10 am — early check-in if possible.',
    edit: { at: [-2, '10:28', 'res'], eta: '10:30', tags: ['early'] } },
  { g: 'shah', a: -18, n: 3, type: 'PRM', plan: 'CP', src: 'Booking.com', book: [-24, '19:20', 'desk'], in: '14:45', out: '10:15', settle: 'Card', inv: 'guest' },
  { g: 'shah', a: -4, n: 2, type: 'PRM', plan: 'CP', src: 'Booking.com', book: [-11, '10:00', 'res'], in: '14:45', move: { at: [-4, '22:10', 'desk'], from: '302' },
    out: '10:20', settle: 'Card', inv: 'guest' },
  { g: 'gokhale', a: -17, n: 2, type: 'DLX', plan: 'BAR', src: 'Agoda', ad: 1, book: [-20, '09:40', 'res'],
    pay: [[-20, '09:43', 'res', 'all', 'Bank transfer', 'Agoda prepaid · AG-77011239']], in: '15:15', out: '10:25', inv: 'guest' },
  { g: 'gokhale', a: -1, n: 2, type: 'DLX', plan: 'BAR', src: 'Agoda', ad: 1, book: [-5, '09:35', 'res'],
    pay: [[-5, '09:38', 'res', 'all', 'Bank transfer', 'Agoda prepaid · AG-77145520']], edit: { at: [-1, '12:00', 'res'], eta: '22:30', tags: ['late'] }, in: '22:40' },

  // ---- Medical stays (very common in Kolkata), walk-ins and short stays
  { g: 'tiwari', a: -21, n: 9, type: 'STD', plan: 'BAR', src: 'Phone', ad: 1, book: [-22, '18:40', 'desk'], in: '19:30',
    pay: [[-18, '10:30', 'desk', { n: 3 }, 'UPI', 'UPI ref 7719 2034 5568']], out: '08:30', settle: 'UPI', inv: 'guest', grc: { purpose: 'Medical' } },
  { g: 'mukherjee', a: -24, n: 2, type: 'STD', plan: 'BAR', src: 'Phone', ad: 1, book: [-26, '17:30', 'desk'], in: '13:45', out: '09:40', settle: 'Cash', inv: 'guest', grc: { purpose: 'Medical' } },
  { g: 'mukherjee', a: -15, n: 2, type: 'STD', plan: 'BAR', src: 'Phone', ad: 1, book: [-17, '12:00', 'res'], in: '17:30', out: '08:15', settle: 'UPI', inv: 'guest', grc: { purpose: 'Medical' } },
  { g: 'mukherjee', a: -8, n: 1, type: 'STD', plan: 'BAR', src: 'Phone', ad: 1, book: [-10, '11:40', 'res'], in: '17:20', out: '08:10', settle: 'UPI', inv: 'guest', grc: { purpose: 'Medical' } },
  { g: 'islam', a: -12, n: 10, type: 'STT', plan: 'BAR', src: 'Phone', book: [-14, '13:30', 'res'], in: '18:40', f3: { arr: [-11, '10:20'], dep: [-2, '12:00'] },
    pay: [[-12, '18:44', 'desk', { n: 4 }, 'Cash', 'Advance for 4 nights']], out: '09:30', settle: 'Cash', inv: 'guest', grc: { purpose: 'Medical', from: 'Dhaka', to: 'Dhaka' } },
  { g: 'islam', a: -12, n: 10, type: 'STT', plan: 'BAR', src: 'Phone', book: [-14, '13:34', 'res'], req: 'Second room for the family.', in: '18:43',
    f3: { arr: [-11, '10:22'], dep: [-2, '12:02'] }, out: '09:32', settle: 'Cash', inv: 'guest', grc: { purpose: 'Medical', from: 'Dhaka', to: 'Dhaka' } },
  { g: 'jahan', a: -3, n: 10, type: 'STT', plan: 'BAR', src: 'Walk-in', book: [-3, '11:30', 'desk'], pay: [[-3, '11:35', 'desk', { n: 3 }, 'Cash', 'Advance for 3 nights']],
    in: '11:40', f3: { arr: [-3, '15:10'] }, grc: { purpose: 'Medical', from: 'Chattogram', to: 'Chattogram' },
    charges: [[2, '09:15', 'laundry', 'Laundry: 6 pieces', 420]] },
  { g: 'dorji', a: -11, n: 4, type: 'STD', plan: 'BAR', src: 'Walk-in', book: [-11, '12:10', 'desk'], pay: [[-11, '12:15', 'desk', 'all', 'Cash', '']],
    in: '12:20', out: '10:10', inv: 'guest', grc: { purpose: 'Leisure', from: 'Phuentsholing', to: 'Thimphu' } },
  { g: 'shrestha', a: -2, n: 3, type: 'STT', plan: 'BAR', src: 'Phone', book: [-6, '15:10', 'res'], in: '12:50', grc: { purpose: 'Visiting family or friends' } },
  { g: 'bajwa', a: -1, n: 1, type: 'STD', plan: 'BAR', src: 'Walk-in', ad: 1, book: [-1, '21:15', 'desk'], pay: [[-1, '21:18', 'desk', 'all', 'Cash', '']], in: '21:25', out: '09:20', inv: 'guest' },
  { g: 'das', a: -9, n: 3, type: 'STT', plan: 'BAR', src: 'Phone', ad: 1, book: [-12, '17:10', 'desk'], pay: [[-9, '14:10', 'desk', 'all', 'Cash', 'Paid in full at check-in']], in: '14:15',
    shorten: { at: [-8, '20:10', 'mgr'], nights: 2, note: 'Leaving a day early — family emergency.', refund: ['Cash', 'Left a day early'] }, out: '08:40', inv: 'guest' },

  // ---- From abroad
  { g: 'clarke', a: -8, n: 4, type: 'DLX', plan: 'CP', src: 'Booking.com', ad: 1, book: [-19, '10:40', 'res'], upgrade: 'PRM', in: '14:35',
    f3: { arr: [-7, '10:15'], dep: [-4, '13:20'] }, out: '10:45', settle: 'Card', inv: 'guest', grc: { from: 'Delhi', to: 'Darjeeling' } },
  { g: 'johnson', a: -2, n: 5, type: 'PRM', plan: 'CP', src: 'Booking.com', ad: 1, book: [-16, '11:10', 'res'], in: '16:20', f3: { arr: [-1, '09:50'] },
    grc: { from: 'Varanasi', to: 'Darjeeling' },
    charges: [[1, '07:45', 'transport', 'Taxi to Salt Lake Sector V and back', 1100]] },
  { g: 'martin', a: 0, n: 3, type: 'DLX', plan: 'CP', src: 'Agoda', book: [-14, '10:05', 'res'], pay: [[-14, '10:08', 'res', 'all', 'Bank transfer', 'Agoda prepaid · AG-77098812']],
    edit: { at: [-1, '15:00', 'res'], eta: '10:00', tags: ['early'] }, in: '09:55', f3: { arr: false }, grc: { from: 'Paris', to: 'Puri' } },
  { g: 'almansoori', a: -20, n: 3, type: 'EXS', plan: 'BAR', src: 'Phone', ad: 1, book: [-24, '14:50', 'res'], in: '15:10', f3: { arr: [-19, '09:30'], dep: [-17, '12:30'] },
    out: '10:30', settle: 'Card', inv: 'guest', grc: { purpose: 'Business', from: 'Dubai', to: 'Dubai' } },
  { g: 'almansoori', a: -3, n: 3, type: 'EXS', plan: 'BAR', src: 'Phone', ad: 1, book: [-7, '13:20', 'res'], in: '15:50', f3: { arr: [-2, '10:05'], dep: false },
    out: '11:30', settle: 'Card', inv: 'guest', grc: { purpose: 'Business', from: 'Dubai', to: 'Dubai' } },
  { g: 'obrien', a: 5, n: 3, type: 'PRM', plan: 'CP', src: 'Website', book: [-4, '06:40', 'web'] },
  { g: 'kowalska', a: 11, n: 4, type: 'DLX', plan: 'CP', src: 'Booking.com', ad: 1, book: [-6, '13:40', 'res'] },

  // ---- Cancellations and a no-show
  { g: 'khanna', a: 7, n: 2, type: 'DLX', plan: 'BAR', src: 'Website', book: [-6, '21:25', 'web'], cancel: { at: [-1, '19:42'], online: true } },
  { g: 'basu', a: -13, n: 2, type: 'DLX', plan: 'CP', src: 'Phone', book: [-22, '16:45', 'res'], pay: [[-22, '16:50', 'res', 'night', 'UPI', 'UPI ref 9182 5530 1147']],
    cancel: { at: [-16, '11:30', 'mgr'], refund: ['UPI', 'Cancelled within the free cancellation period'] } },
  { g: 'bhatt', a: -6, n: 1, type: 'STD', plan: 'BAR', src: 'Booking.com', ad: 1, book: [-13, '10:30', 'res'], noShow: true },
];

/* Out-of-order periods: [room, first night off, back in service, reason, created [day, time, who], ended early [day, time, who]]. */
const BLOCKS = [
  { room: '202', start: -20, end: -18, reason: 'Water leakage repair', at: [-21, '16:00', 'sb'] },
  { room: '403', start: -6, end: -1, reason: 'Wardrobe and wall panel repair', at: [-7, '12:30', 'sb'], ended: [-3, '11:15', 'sb'] },
  { room: '305', start: -1, end: 2, reason: 'AC compressor replacement', at: [-2, '15:40', 'vs'] },
  { room: '104', start: 8, end: 10, reason: 'Bathroom re-tiling', at: [-3, '11:00', 'am'] },
];

/* Shift handover notes: [day, time, who, headline, details]. {room:guest} becomes that guest’s room. */
const HANDOVER = [
  [-27, '06:55', 'night', 'First night on the new system.', 'Night audit closed without problems. Today’s housekeeping sheet is ready on the tablets.'],
  [-21, '22:50', 'desk', 'Room 202 has a water leak.', 'Engineering has taken it off sale until the day after tomorrow. Plumber comes at 10:00.'],
  [-16, '14:55', 'desk', 'Shreya Basu cancelled her stay.', 'Her UPI advance has been refunded — the refund is on the folio.'],
  [-12, '22:55', 'desk', 'Two rooms for the Islam family from Dhaka.', 'Here for treatment at the hospital. Form III to be filed in the morning; hospital shuttle at 08:00.'],
  [-7, '14:50', 'desk', 'Room 403 off sale.', 'Wardrobe and wall panel repair — engineering expects about five days.'],
  [-5, '06:55', 'night', 'One no-show last night.', 'Vivek Bhatt (Booking.com) did not arrive and was marked as a no-show in the night audit. Reservations to inform Booking.com.'],
  [-4, '22:45', 'desk', 'Tanvi Shah moved rooms.', 'No hot water in 302 — moved her to {room:shah}. Engineering to check the geyser in 302 first thing.'],
  [-3, '14:55', 'desk', 'Nusrat Jahan (Bangladesh) in {room:jahan} for ten nights.', 'Form III arrival report filed. Medical visa — the hospital shuttle leaves at 08:00.'],
  [-2, '15:45', 'mgr', 'Room 305 is off sale until {2}.', 'The AC compressor is being replaced. Please do not assign 305.'],
  [-1, '14:55', 'desk', 'VIP in {room:sarkar}: Malini Sarkar.', 'Never confirm her stay to callers. Vegan meals — the kitchen has been told.'],
  [-1, '22:55', 'desk', 'Late arrival checked in: Sameer Gokhale.', 'Agoda prepaid, in {room:gokhale}. Walk-in Karan Bajwa in {room:bajwa}, paid in cash.'],
  [0, '14:55', 'desk', 'Sophie Martin’s Form III is due.', 'She checked in this morning — file the arrival report with the FRRO before tomorrow morning.'],
];

/* Later changes in the admin panel: price rise, a member of staff leaving, a source switched off. */
const CHANGES = [
  { at: [-12, '11:00', 'am'], kind: 'rate' },
  { at: [-10, '18:30', 'am'], kind: 'staff-left', staff: 'dj' },
  { at: [-5, '12:00', 'sb'], kind: 'source-off', source: 'Expedia' },
  // a new hire the general manager invited yesterday evening: the invite link is still open
  { at: [-1, '17:40', 'am'], kind: 'invite', person: { name: 'Nisha Roy', role: 'frontdesk', title: 'Guest service associate (trainee)', department: 'Front office', shift: 'morning' } },
];

/* Maintenance jobs on today’s housekeeping sheet: [room, job, minutes, done at]. */
const MAINTENANCE = [['106', 'Fix the bathroom tap', 20, '10:20'], ['305', 'AC compressor replacement', 90, null]];

module.exports = { INDIA, FILL, WEBSITE, ROOM_TYPES, ROOMS, PLANS, BAR, EXTRAS, SOURCES, STAFF, GUESTS, STAYS, BLOCKS, HANDOVER, CHANGES, MAINTENANCE };
