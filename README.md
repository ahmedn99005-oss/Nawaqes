# نواقص المكتبة

أبلكيشن لتسجيل نواقص المكتبة أول بأول، مقسمة على المراكز (النصرية، الممر، الشقة)، وإرسال الكشف للمخزن على واتساب أو كملف PDF.

- **الرابط:** https://ahmedn99005-oss.github.io/nawaqes/
- **التثبيت على أندرويد:** افتح الرابط في Chrome، ودوس «ثبّت الأبلكيشن» اللي فوق، أو من قايمة ⋮ اختار «تثبيت التطبيق».
- **البيانات:** محفوظة في Firebase (Firestore) على حساب جوجل بتاعك. ادخل بنفس الحساب على الموبايل والكمبيوتر وهتلاقي نفس الكشف. الأبلكيشن بيشتغل من غير نت، وأي تعديل بيتبعت أول ما النت يرجع.

## إعداد Firebase (مرة واحدة)

1. افتح https://console.firebase.google.com وادخل بحساب جوجل.
2. **Create a project** وسمّيه `nawaqes`. تقدر تقفل Google Analytics.
3. **Build ← Firestore Database ← Create database**: اختار أي مكان، وبعدين **Start in production mode**.
   - من تبويب **Rules** امسح اللي مكتوب، والصق محتوى ملف [`firestore.rules`](firestore.rules)، ودوس **Publish**.
4. **Build ← Authentication ← Get started ← Sign-in method ← Google**: فعّله واختار إيميلك واحفظ.
   - من **Settings ← Authorized domains ← Add domain** ضيف: `ahmedn99005-oss.github.io`
5. من الترس ⚙️ **Project settings ← Your apps** دوس على أيقونة الويب `</>`، سمّيه `nawaqes`، ودوس **Register app**.
   - انسخ الجزء اللي فيه `firebaseConfig` وحطه في ملف [`firebase-config.js`](firebase-config.js) مكان `null`، أو ابعته لـClaude يحطه.

## الملفات

| الملف | وظيفته |
|---|---|
| `index.html` | شكل الأبلكيشن |
| `app.js` | كل شغل الأبلكيشن: النواقص، المراكز، البحث، الصوت، الكشف، الـPDF |
| `store.js` | الاتصال بـFirebase: الدخول بجوجل وحفظ البيانات |
| `firebase-config.js` | إعدادات مشروع Firebase |
| `sw.js` | بيخلي الأبلكيشن يتثبت ويفتح من غير نت |
| `firestore.rules` | قواعد الأمان: كل حساب يشوف بياناته بس |

## التحديثات

أي تعديل يتعمل في الـrepo ده على فرع `main` بيتنشر لوحده على GitHub Pages في حوالي دقيقة، والأبلكيشن بياخده أول ما يتفتح والنت شغال.
