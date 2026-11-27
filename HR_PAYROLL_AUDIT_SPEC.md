# مواصفات منظومة الموارد البشرية والمرتبات (HR & Payroll Official Rules Spec — Updated)

> **الحالة:** ✅ تم تطبيق واعتماد **قواعد المصنع الرسمية النهائية** بالكامل في الباك إند والفرونت إند وتوحيد المعادلة بين `PayrollPanel.tsx` و`LoansPanel.tsx` و`backend/api/hr_reports.py` و`backend/api/hr_attendance_io.py`.

---

## 1. معدل اليوم والساعة (Daily & Hourly Rate)
- **أجر اليوم:** ثابت على 30 يوماً: $\text{dayRate} = \frac{\text{monthly\_salary}}{30}$.
- **أجر الساعة:** ديناميكي حسب ساعات الشيفت الرسمية (`official_start_time` → `official_end_time`، الافتراضي **9 ساعات** من `08:30` إلى `17:30`):
  $$\text{hourRate} = \frac{\text{dayRate}}{\text{shiftHours}}$$
- تم تصحيح جميع النصوص التي كانت تذكر القسمة على `8` ساعات في `AttendanceRecordsPanel.tsx` و`PenaltiesPanel.tsx` و`backend/api/hr_reports.py`، وتحديث الحد الأقصى لساعات الجزاء في `PenaltiesPanel.tsx` ليطابق `shiftHours`.

## 2. تاريخ التعيين (`hire_date`) وتاريخ ترك العمل (`termination_date`) ومحاسبة منتصف الشهر
- أُضيف الحقلان الاختياريان `hire_date` و`termination_date` على `HREmployee` (`models_hr.py` + الهجرة `0041_hr_payroll_official_rules.py` + `ensure_schema_columns()` + `serializers.py` + `views_hr.py` + `EmployeesPanel.tsx`).
- **النطاق الفعلي داخل الشهر:**
  $$\text{effective\_start} = \max(\text{month\_start},\; \text{hire\_date}), \qquad \text{effective\_end} = \min(\text{month\_end},\; \text{termination\_date})$$
  أي يوم خارج هذا النطاق يُتجاهل تماماً (لا يُحسب غياباً ولا إجازة أسبوعية ولا يدخل في خصم الأحد).
- **الموظف المنتظم طوال الشهر (`hire_date <= month_start` و`termination_date >= month_end`):**
  - في الشهر المكتمل: $\text{earnedDays} = \max(0,\; 30 - \text{unexcusedAbsence} - \text{excusedUnpaidAbsence} - \text{sundayDeduction}) + \text{workedWeeklyOff} \times \text{mult}$ (أياً كان طول الشهر 28 / 29 / 30 / 31، بدون شرط النصف المربك).
  - في منتصف الشهر المفتوح: $\text{earnedDays} = \min(30,\; \text{attendedRegular} + \text{paidSundays}) + \text{workedWeeklyOff} \times \text{mult}$.
- **الموظف المعيَّن في منتصف الشهر (`hire_date > month_start`) أو التارك قبل نهاية الشهر (`termination_date < month_end`):**
  - يُحاسب بالأيام الفعلية فقط: $\text{earnedDays} = \min(30,\; \text{attendedRegular} + \text{paidSundays}) + \text{workedWeeklyOff} \times \text{mult}$، مع تصفية أيام الأسبوع الستة السابقة لكل يوم أحد لتشمل فقط الأيام داخل `[hire_date, termination_date]`.

## 3. الخيارات الثلاثة لقرار الغياب (`absence_decision`)
أُضيف الحقل `absence_decision` على `HRAttendanceRecord` (مع توافق كامل مع السجلات القديمة):
1. **🔴 بدون عذر (`unexcused` — الافتراضي عند غياب بدون قرار):** خصم **يومين** (`1 يوم` من `earnedDays` + `1 يوم` جزاء غياب إضافي بحد أدنى، أو `max(1, rule_days - 1)` إذا تجاوزت قاعدة `absence` يومين) + يدخل في عدّاد خصم يوم الإجازة الأسبوعية.
2. **🟡 بعذر — خصم اليوم فقط (`excused_unpaid`):** خصم **يوم واحد فقط** من `earnedDays`، بدون جزاء إضافي وبدون تأثير على يوم الإجازة الأسبوعية.
3. **🟢 على حساب الشركة — مدفوع (`paid_company`):** مدفوع الأجر بالكامل 100% دون أي خصم ودون تأثير على يوم الإجازة الأسبوعية.

## 4. شرائح خصم يوم الإجازة الأسبوعية (5 شرائح رسمية)
وفق عدد أيام الغياب **بدون عذر** في الأيام الستة السابقة ضمن فترة التوظيف:
- `0` أو `1` يوم ⬅️ خصم **`0`** (الأحد مدفوع بالكامل)
- `2` يوم ⬅️ خصم **`1/3`** يوم الأحد
- `3` أيام ⬅️ خصم **`1/2`** يوم الأحد
- `4` أيام ⬅️ خصم **`2/3`** يوم الأحد
- `5` أو `6` أيام ⬅️ خصم **`1.0`** يوم الأحد كاملاً

مع خصم الإجازة مرة واحدة فقط، وإصلاح عبور الشهور في `views_hr.py` (تحديث الشهر التالي لآخر 6 أيام والشهر/الموظف القديم عند التعديل)، وحذف سجل الأحد الشبح عند خلو الأسبوع من السجلات، وإصلاح ورقة العامل المطبوعة في `PayrollPanel.tsx`.

## 5. البصمة الناقصة + الإضافي + التصفير اليدوي للتأخير (`manual_deduction`)
- **البصمة الناقصة (`missing_punch`):** أي بصمة واحدة (`check_in` أو `check_out`) تُحسب **حضوراً مؤقتاً** وحالتها `pending_review` حتى قرار المشرف.
- **الإضافي:** لا يُصرف ولا يُخزَّن لسجل غير حاضر ولا ليوم الإجازة الأسبوعية بدون `check_in`.
- **التصفير اليدوي للتأخير (`manual_deduction=True`):** يُحفظ في قاعدة البيانات ويُعرض في الـ Serializer، ولا يُشغّل الـ Fallback الديناميكي للتأخير أبداً عند تفعيله.

## 6. زر «⚠️ يحتاج قرار المشرف» وتوحيد `LoansPanel` مع `PayrollPanel`
- أُضيف زر الفلتر السريع **«⚠️ يحتاج قرار المشرف»** مع عدّاد فوري في `AttendanceRecordsPanel.tsx` لعرض سجلات `pending_review` والغياب غير المحسوم، وفُصلت الخصومات **المعتمدة** عن الخصومات **قيد المراجعة** في الواجهة و`/stats/`.
- وُحّدت الحسابات عبر `computeEmployeeMonthPayroll` في `hrShared.tsx` بين `PayrollPanel.tsx` و`LoansPanel.tsx`، مع إصلاح أخطاء أول وآخر يوم في الشهر في `LoansPanel.tsx`.
