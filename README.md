# Missile Calm (PWA)

אפליקציית PWA שמתחברת להתרעות פיקוד העורף, מסווגת התרעות לטיל/כלי טיס/התראה מוקדמת, ומנגנת/מקריאה הודעה שונה לכל סוג.

## מה נבנה

- התרעות בזמן אמת דרך `SSE` מהשרת.
- התממשקות למקור ההתרעות של פיקוד העורף.
- הודעות קול:
  - התראה מוקדמת: `ירי מאיראן בקרוב`
  - טילים: `טילים, נא להתמגן`
  - כלי טיס: `תרגעו, זה רק כלי טיס`
- צליל שונה לכל סוג איום.
- פופאפ קופץ בזמן אמת.
- PWA עם `manifest` ו-`service worker`.

## הפעלה מקומית

1. התקן תלויות:

```bash
npm install
```

2. הרץ:

```bash
npm run dev
```

3. פתח בדפדפן:

```text
http://localhost:8080
```

## משתני סביבה

אפשר ליצור קובץ `.env` לפי `.env.example`:

- `PORT` ברירת מחדל: `8080`
- `ALERT_SOURCE_URL` ברירת מחדל: `https://www.oref.org.il/WarningMessages/alert/alerts.json`
- `POLL_INTERVAL_MS` ברירת מחדל: `2500`

## בדיקה מהירה

במסך יש כפתורי בדיקה: טיל / כלי טיס / התראה מוקדמת.

או דרך API:

```bash
curl -X POST http://localhost:8080/api/test-alert -H "Content-Type: application/json" -d "{\"type\":\"missile\"}"
```

## הערות חשובות על עבודה ברקע

- ב-PWA, עבודה "תמיד ברקע" תלויה במגבלות מערכת ההפעלה והדפדפן.
- לקבלת אמינות גבוהה כשהאפליקציה סגורה, מומלץ להוסיף מנגנון `Web Push` עם שרת Push ייעודי.
- לצורך הפצה כאפליקציית אנדרואיד והפקת `AAB`, מומלץ לעטוף עם `TWA` או `Capacitor`.

## מסלול מהיר ל-AAB (השלב הבא)

1. לפרוס את השרת וה-PWA על HTTPS.
2. להשתמש ב-`Bubblewrap (TWA)` כדי לייצר פרויקט אנדרואיד.
3. להריץ build חתום ולהפיק קובץ `AAB`.

אם תרצה, בשלב הבא אגדיר לך כאן בריפו גם תבנית `Capacitor Android` כך שנוכל לייצא `AAB` ישירות מפרויקט זה.

## הדרך הכי קלה להעלות אתר פעיל

המסלול הכי פשוט לפרויקט הזה הוא `Render` (שרת Node אחד, בלי קונפיגורציה מורכבת).

1. דחוף את הריפו ל-GitHub.
2. היכנס ל-Render ובחר `New` -> `Blueprint`.
3. בחר את הריפו, ו-Render יזהה אוטומטית את הקובץ `render.yaml`.
4. אשר יצירה ופריסה.
5. בסיום תקבל URL פעיל ב-HTTPS.

### הערות

- Health check מוגדר לנתיב `/health`.
- אפשר לשנות משתני סביבה ישירות ב-Render בלי לשנות קוד.
- התוכנית החינמית יכולה "להירדם" כשאין תעבורה.

## GitHub Pages לפרונט + Render לבקאנד

הגדרה זו כבר מוכנה בריפו:

- Workflow אוטומטי לפריסה: `.github/workflows/pages.yml`
- קבצי הפרונט נפרסים מתיקיית `public`
- קובץ הגדרת API בצד לקוח: `public/config.js`

### שלבי הפעלה

1. פרוס את השרת ב-Render וקבל URL כמו:
   `https://missile-calm.onrender.com`
2. ערוך את `public/config.js` והכנס את ה-URL:

```js
window.APP_CONFIG = {
  API_BASE_URL: "https://missile-calm.onrender.com"
};
```

3. בצע push ל-`main`.
4. ב-GitHub: `Settings -> Pages -> Build and deployment -> Source: GitHub Actions`.
5. המתן ל-Workflow `Deploy GitHub Pages`.

כתובת ה-Pages תהיה בדרך כלל:
`https://<username>.github.io/missle-calm/`

### חשוב

- Pages הוא סטטי בלבד, לכן ה-API חייב לרוץ ב-Render (או שרת אחר).
- ב-Render אפשר להקשיח CORS בעזרת משתנה סביבה `CORS_ORIGIN` לכתובת ה-Pages שלך.
