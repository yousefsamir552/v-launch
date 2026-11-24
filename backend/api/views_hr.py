from .views_common import *
from .views_common import _truthy_permission_keys, _accessory_price_snapshot


def _month_key_for(target_date) -> str:
    if not target_date:
        return ''
    if hasattr(target_date, 'strftime'):
        return target_date.strftime('%Y-%m')
    return str(target_date)[:7]


def _locked_month_error(target_date):
    """يمنع تعديل حضور أو جزاءات أو سُلف شهر معتمد ومغلق في HRPayrollSnapshot."""
    m_key = _month_key_for(target_date)
    if m_key and HRPayrollSnapshot.objects.filter(month=m_key, is_locked=True).exists():
        return Response(
            {'detail': f'تم اعتماد وإغلاق كشف رواتب شهر {m_key} ولا يمكن تعديل بياناته إلا بعد إعادة فتح الشهر.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    return None

class HRJobTitleViewSet(BasePermViewSet):
    """وظائف المصنع: إضافة/تعديل/حذف، مع منع حذف وظيفة مرتبطة بموظفين."""
    queryset = HRJobTitle.objects.all()
    serializer_class = HRJobTitleSerializer
    permission_classes = [CanManageHR]
    required_hr_section = 'jobs'

    def create(self, request, *args, **kwargs):
        data = request.data
        title = str(data.get('title') or '').strip()
        department = str(data.get('department') or '').strip()
        if not title:
            return Response({'detail': 'اسم الوظيفة مطلوب'}, status=status.HTTP_400_BAD_REQUEST)
        if department not in HR_DEPARTMENT_LABELS:
            return Response({'detail': 'القسم المحدد غير صحيح'}, status=status.HTTP_400_BAD_REQUEST)
        if HRJobTitle.objects.filter(title__iexact=title, department=department).exists():
            return Response({'detail': 'هذه الوظيفة مسجلة بالفعل في نفس القسم'}, status=status.HTTP_400_BAD_REQUEST)
        obj = HRJobTitle.objects.create(
            client_id=(data.get('id') or data.get('client_id') or None),
            title=title,
            department=department,
        )
        return Response(HRJobTitleSerializer(obj).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        obj = self.get_object()
        data = request.data
        title = obj.title
        department = obj.department
        if data.get('title') is not None:
            title = str(data.get('title') or '').strip()
            if not title:
                return Response({'detail': 'اسم الوظيفة مطلوب'}, status=status.HTTP_400_BAD_REQUEST)
        if data.get('department') is not None:
            department = str(data.get('department') or '').strip()
            if department not in HR_DEPARTMENT_LABELS:
                return Response({'detail': 'القسم المحدد غير صحيح'}, status=status.HTTP_400_BAD_REQUEST)
        if HRJobTitle.objects.filter(title__iexact=title, department=department).exclude(pk=obj.pk).exists():
            return Response({'detail': 'هذه الوظيفة مسجلة بالفعل في نفس القسم'}, status=status.HTTP_400_BAD_REQUEST)
        obj.title = title
        obj.department = department
        obj.save()
        return Response(HRJobTitleSerializer(obj).data)

    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()
        if obj.employees.exists():
            return Response(
                {'detail': 'لا يمكن حذف هذه الوظيفة لوجود موظفين مرتبطين بها. يرجى نقل الموظفين إلى وظيفة أخرى أولاً.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class HREmployeeViewSet(BasePermViewSet):
    """ملفات الموظفين مع التحقق من كود البصمة وقواعد تطبيق الخصم."""
    queryset = HREmployee.objects.select_related('job').all()
    serializer_class = HREmployeeSerializer
    permission_classes = [CanManageHR]
    required_hr_section = 'employees'

    def get_queryset(self):
        return rank_scoped_queryset(
            HREmployee.objects.select_related('job').all(), self.request
        )

    def create(self, request, *args, **kwargs):
        data = request.data
        name = str(data.get('name') or '').strip()
        if not name:
            return Response({'detail': 'اسم الموظف مطلوب'}, status=status.HTTP_400_BAD_REQUEST)
        job = resolve_by_id(HRJobTitle, data.get('job_id') or data.get('job'))
        if not job:
            return Response({'detail': 'يرجى اختيار وظيفة صحيحة للموظف'}, status=status.HTTP_400_BAD_REQUEST)
        if not can_edit_employee_salary(request):
            # تحديد مرتب الموظف يتطلب صلاحية الرواتب حتى لا يصبح تجاوزاً للصلاحيات.
            return Response(
                {'detail': 'لا تملك صلاحية تحديد مرتب الموظف (صلاحية الرواتب مطلوبة).'},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            salary = float(data.get('monthly_salary') or 0)
        except (TypeError, ValueError):
            return Response({'detail': 'المرتب الشهري غير صحيح'}, status=status.HTTP_400_BAD_REQUEST)
        if salary <= 0:
            return Response({'detail': 'المرتب الشهري يجب أن يكون أكبر من صفر'}, status=status.HTTP_400_BAD_REQUEST)
        employee_code = str(data.get('employee_code') or '').strip()
        if employee_code and HREmployee.objects.filter(employee_code=employee_code).exists():
            return Response({'detail': 'كود الموظف / ID البصمة مستخدم بالفعل'}, status=status.HTTP_400_BAD_REQUEST)

        mode = data.get('rule_application_mode') or 'auto'
        if mode not in ('auto', 'manual_review'):
            mode = 'auto'

        rank, rank_error = resolve_rank_for_grant(request, data.get('rank_level'))
        if rank_error:
            return rank_error

        obj = HREmployee(
            client_id=(data.get('id') or data.get('client_id') or None),
            employee_code=employee_code,
            name=name,
            job=job,
            monthly_salary=salary,
            rule_application_mode=mode,
            national_id=data.get('national_id') or None,
            phone=data.get('phone') or None,
            photo=clean_image_value(data.get('photo') or '', 'hr', 'صورة الموظف') or None,
            notes=data.get('notes') or None,
            is_active=bool(data.get('is_active', True)),
            rank_level=rank,
        )
        birth_date = data.get('birth_date')
        if birth_date:
            obj.birth_date = parse_date(str(birth_date))
        obj.save()
        return Response(
            HREmployeeSerializer(obj, context={'request': request}).data,
            status=status.HTTP_201_CREATED,
        )

    def update(self, request, *args, **kwargs):
        obj = self.get_object()
        if not can_manage_target(request, obj.rank_level):
            return Response(
                {'detail': 'لا تملك صلاحية تعديل موظف بهذه الرتبة'},
                status=status.HTTP_403_FORBIDDEN,
            )
        data = request.data.copy()
        if 'monthly_salary' in data and not can_edit_employee_salary(request):
            # رفض صريح بدلاً من الإسقاط الصامت: لا نُظهر نجاحاً زائفاً للمستخدم
            # ولا نسمح بتعديل جزئي يوهم بحفظ المرتب بينما لم يُحفظ فعلاً.
            return Response(
                {'detail': 'لا تملك صلاحية تعديل المرتب الشهري (صلاحية الرواتب مطلوبة).'},
                status=status.HTTP_403_FORBIDDEN,
            )

        if data.get('name') is not None:
            name = str(data.get('name') or '').strip()
            if not name:
                return Response({'detail': 'اسم الموظف مطلوب'}, status=status.HTTP_400_BAD_REQUEST)
            obj.name = name
        if data.get('job_id') is not None or data.get('job') is not None:
            job = resolve_by_id(HRJobTitle, data.get('job_id') or data.get('job'))
            if not job:
                return Response({'detail': 'يرجى اختيار وظيفة صحيحة'}, status=status.HTTP_400_BAD_REQUEST)
            obj.job = job
        if data.get('monthly_salary') is not None:
            try:
                salary = float(data.get('monthly_salary') or 0)
            except (TypeError, ValueError):
                return Response({'detail': 'المرتب الشهري غير صحيح'}, status=status.HTTP_400_BAD_REQUEST)
            if salary <= 0:
                return Response({'detail': 'المرتب الشهري يجب أن يكون أكبر من صفر'}, status=status.HTTP_400_BAD_REQUEST)
            obj.monthly_salary = salary
        if data.get('rule_application_mode') is not None:
            mode = data.get('rule_application_mode') or 'auto'
            obj.rule_application_mode = mode if mode in ('auto', 'manual_review') else 'auto'
        if data.get('employee_code') is not None:
            code = str(data.get('employee_code') or '').strip()
            if code:
                if HREmployee.objects.exclude(pk=obj.pk).filter(employee_code=code).exists():
                    return Response({'detail': 'كود الموظف / ID البصمة مستخدم بالفعل'}, status=status.HTTP_400_BAD_REQUEST)
                obj.employee_code = code
            # إذا تُرك الحقل فارغاً نحتفظ بالكود الحالي بدلاً من تفريغه
        if 'national_id' in data:
            obj.national_id = data.get('national_id') or None
        if 'phone' in data:
            obj.phone = data.get('phone') or None
        if 'photo' in data:
            obj.photo = clean_image_value(data.get('photo') or '', 'hr', 'صورة الموظف') or None
        if 'notes' in data:
            obj.notes = data.get('notes') or None
        if 'is_active' in data:
            obj.is_active = bool(data.get('is_active'))
        if 'birth_date' in data:
            bd = data.get('birth_date')
            obj.birth_date = parse_date(str(bd)) if bd else None
        if data.get('rank_level') not in (None, ''):
            new_rank, rank_error = resolve_rank_for_grant(request, data.get('rank_level'))
            if rank_error:
                return rank_error
            obj.rank_level = new_rank
        obj.save()
        return Response(HREmployeeSerializer(obj, context={'request': request}).data)

    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()
        if not can_manage_target(request, obj.rank_level):
            return Response(
                {'detail': 'لا تملك صلاحية حذف موظف بهذه الرتبة'},
                status=status.HTTP_403_FORBIDDEN,
            )
        obj.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class HRAttendanceSettingsViewSet(viewsets.ViewSet):
    """إعدادات الحضور والانصراف العامة (Singleton)."""
    permission_classes = [CanManageHR]
    required_hr_section = 'rules'

    def list(self, request):
        ensure_initial_seed()
        obj = HRAttendanceSettings.get_solo()
        return Response(HRAttendanceSettingsSerializer(obj).data)

    def create(self, request):
        return self._update_settings(request)

    @action(detail=False, methods=['post', 'put', 'patch'])
    def update_settings(self, request):
        return self._update_settings(request)

    def _update_settings(self, request):
        obj = HRAttendanceSettings.get_solo()
        before = snapshot_instance(obj)
        data = request.data

        start_time = parse_time_value(data.get('official_start_time'))
        if start_time:
            obj.official_start_time = start_time
        end_time = parse_time_value(data.get('official_end_time'))
        if end_time:
            obj.official_end_time = end_time
        if data.get('weekly_off_day'):
            day = str(data.get('weekly_off_day')).strip()
            if day in WEEK_DAY_LABELS:
                obj.weekly_off_day = day
        if data.get('weekly_off_work_multiplier') not in (None, ''):
            mult = max(Decimal('0.00'), to_decimal(data.get('weekly_off_work_multiplier'), Decimal('1.00'), places=2))
            obj.weekly_off_work_multiplier = mult
        if isinstance(data.get('rules_json'), list):
            obj.rules_json = data.get('rules_json')
        if isinstance(data.get('overtime_rules'), list):
            obj.overtime_rules = data.get('overtime_rules')
        # الشهر الحسابي ثابت دائماً 30 يوماً
        obj.month_calculation_days = 30
        obj.save()
        changes = build_field_changes(before, snapshot_instance(obj), model=HRAttendanceSettings)
        log_action(
            request,
            section='الموارد البشرية',
            action_type='settings',
            target_name='إعدادات الحضور والانصراف',
            details='حدّث إعدادات الحضور والانصراف وقواعد التأخير والخصم',
            changes=changes,
            user=resolve_request_user_profile(request),
        )
        return Response(HRAttendanceSettingsSerializer(obj).data)


class HRAttendanceRecordViewSet(BasePermViewSet):
    """سجل الحضور والانصراف اليومي (جاهز لاستقبال بصمات ZKTeco في المرحلة القادمة)."""
    queryset = HRAttendanceRecord.objects.select_related('employee', 'employee__job').all()
    serializer_class = HRAttendanceRecordSerializer
    permission_classes = [CanManageHR]
    required_hr_section = 'attendance'

    def get_queryset(self):
        """سجلات البصمة مع دعم الفلترة الشهرية لتقليل حجم البيانات المرسلة.

        ``month`` (YYYY-MM) يقيّد النطاق بالشهر المطلوب. ومع
        ``include_prev_week=1`` تبدأ النافذة قبل أول يوم بالشهر بـ 6 أيام حتى
        تتوفر أيام الأسبوع السابقة اللازمة لاحتساب خصم الإجازة الأسبوعية
        واستحقاق المرتب. بدون ``month`` يبقى السلوك القديم (كل السجلات) حتى لا
        تتأثر الاستدعاءات العامة مثل النسخ الاحتياطي الشامل.
        """
        qs = rank_scoped_queryset(
            HRAttendanceRecord.objects.select_related('employee', 'employee__job').all(),
            self.request,
            field='employee__rank_level',
        )
        params = self.request.query_params
        if params.get('month'):
            month_start, month_end = self._sheet_month(self.request)
            lookup_start = month_start
            if params.get('include_prev_week') in ('1', 'true', 'yes'):
                lookup_start = month_start - timedelta(days=6)
            qs = qs.filter(date__gte=lookup_start, date__lte=month_end)

        emp_id = params.get('employee_id')
        if emp_id:
            employee = resolve_by_id(HREmployee, emp_id)
            if employee is None:
                return qs.none()
            qs = qs.filter(employee=employee)
        return qs

    def create(self, request, *args, **kwargs):
        data = request.data
        employee = resolve_by_id(HREmployee, data.get('employee_id') or data.get('employee'))
        if not employee:
            return Response({'detail': 'الموظف غير موجود'}, status=status.HTTP_400_BAD_REQUEST)
        hidden = hidden_employee_error(request, employee)
        if hidden:
            return hidden
        try:
            ded_days = float(data.get('calculated_deduction_days') or 0)
            ded_hours = float(data.get('calculated_deduction_hours') or 0)
        except (TypeError, ValueError):
            return Response({'detail': 'قيم الخصم غير صحيحة'}, status=status.HTTP_400_BAD_REQUEST)

        status_val = data.get('status') or 'present'
        if status_val not in dict(HR_ATTENDANCE_STATUS_CHOICES):
            status_val = 'present'

        review_val = data.get('review_status') or 'auto_applied'
        if review_val not in dict(HR_REVIEW_STATUS_CHOICES):
            review_val = 'auto_applied'

        is_excused = bool(data.get('is_excused', False))
        if is_excused:
            # السجل المعذور لا يُطبق عليه خصم.
            ded_days = 0.0
            ded_hours = 0.0

        rec_date = parse_date(str(data.get('date'))) if data.get('date') else date.today()
        locked_err = _locked_month_error(rec_date)
        if locked_err:
            return locked_err
        if HRAttendanceRecord.objects.filter(employee=employee, date=rec_date or date.today()).exists():
            return Response(
                {'detail': f'يوجد سجل حضور مسجّل بالفعل لهذا الموظف بتاريخ {(rec_date or date.today()).isoformat()}'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        check_in_val = parse_time_value(data.get('check_in'))
        check_out_val = parse_time_value(data.get('check_out'))
        # الاحتساب تلقائي دائماً، ويُحترم الخصم اليدوي فقط عند manual_deduction=true.
        manual_deduction = bool(data.get('manual_deduction'))
        settings_obj = HRAttendanceSettings.get_solo()
        computed = compute_attendance(
            settings_obj,
            employee,
            rec_date or date.today(),
            check_in_val,
            check_out_val,
            status_val,
        )
        late_minutes_val = float(computed['late_minutes'] or 0)
        early_minutes_val = float(computed['early_minutes'] or 0)
        if is_excused:
            ded_days = 0.0
            ded_hours = 0.0
            review_val = 'auto_applied'
        elif not manual_deduction:
            ded_days = computed['deduction_days']
            ded_hours = computed['deduction_hours']
            if data.get('review_status') is None:
                review_val = computed['review_status']
        # يوم الإجازة الأسبوعية (من إعدادات الحضور) إجازة مدفوعة فقط عند غياب بصمة الحضور.
        # اليوم الذي سُجّلت له بصمة حضور يُعامل كيوم عمل عادي (خصم تأخير + إضافي).
        if (rec_date or date.today()).weekday() == weekly_off_weekday(settings_obj) and not check_in_val:
            ded_days = 0.0
            ded_hours = 0.0
            late_minutes_val = 0.0
            early_minutes_val = 0.0
            review_val = 'auto_applied'
        obj = HRAttendanceRecord.objects.create(
            client_id=(data.get('id') or data.get('client_id') or None),
            employee=employee,
            date=rec_date or date.today(),
            check_in=check_in_val,
            check_out=check_out_val,
            status=status_val,
            is_excused=is_excused,
            excuse_note=data.get('excuse_note') or None,
            calculated_deduction_days=ded_days,
            calculated_deduction_hours=ded_hours,
            late_minutes=late_minutes_val,
            early_minutes=early_minutes_val,
            review_status=review_val,
        )
        overtime = compute_overtime(settings_obj, obj.check_out, obj.check_in)
        obj.overtime_days = overtime['overtime_days']
        obj.overtime_hours = overtime['overtime_hours']
        obj.save(update_fields=['overtime_days', 'overtime_hours'])
        return Response(HRAttendanceRecordSerializer(obj).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        obj = self.get_object()
        locked_err = _locked_month_error(obj.date)
        if locked_err:
            return locked_err
        data = request.data

        if data.get('employee_id') is not None or data.get('employee') is not None:
            employee = resolve_by_id(HREmployee, data.get('employee_id') or data.get('employee'))
            if not employee:
                return Response({'detail': 'الموظف غير موجود'}, status=status.HTTP_400_BAD_REQUEST)
            hidden = hidden_employee_error(request, employee)
            if hidden:
                return hidden
            obj.employee = employee
        if data.get('date'):
            rec_date = parse_date(str(data.get('date')))
            if rec_date:
                new_locked_err = _locked_month_error(rec_date)
                if new_locked_err:
                    return new_locked_err
                obj.date = rec_date
        if 'check_in' in data:
            obj.check_in = parse_time_value(data.get('check_in'))
        if 'check_out' in data:
            obj.check_out = parse_time_value(data.get('check_out'))
        if data.get('status') is not None:
            status_val = data.get('status') or 'present'
            if status_val not in dict(HR_ATTENDANCE_STATUS_CHOICES):
                status_val = 'present'
            obj.status = status_val
        if 'is_excused' in data:
            obj.is_excused = bool(data.get('is_excused'))
        if 'excuse_note' in data:
            obj.excuse_note = data.get('excuse_note') or None
        if data.get('calculated_deduction_days') is not None:
            try:
                obj.calculated_deduction_days = float(data.get('calculated_deduction_days') or 0)
            except (TypeError, ValueError):
                return Response({'detail': 'قيم الخصم غير صحيحة'}, status=status.HTTP_400_BAD_REQUEST)
        if data.get('calculated_deduction_hours') is not None:
            try:
                obj.calculated_deduction_hours = float(data.get('calculated_deduction_hours') or 0)
            except (TypeError, ValueError):
                return Response({'detail': 'قيم الخصم غير صحيحة'}, status=status.HTTP_400_BAD_REQUEST)
        if data.get('review_status') is not None:
            review = data.get('review_status') or 'auto_applied'
            if review not in dict(HR_REVIEW_STATUS_CHOICES):
                review = 'auto_applied'
            obj.review_status = review

        # اشتقاق حالة الحضور تلقائياً عند تعديل البصمات بدون إرسال الحالة.
        if data.get('status') is None and ('check_in' in data or 'check_out' in data):
            if obj.check_in and obj.check_out:
                obj.status = 'present'
            elif obj.check_in or obj.check_out:
                obj.status = 'missing_punch'
            elif obj.status in ('present', 'missing_punch'):
                obj.status = 'absent'

        explicit_deductions = (
            data.get('calculated_deduction_days') is not None
            or data.get('calculated_deduction_hours') is not None
        )

        settings_obj = HRAttendanceSettings.get_solo()
        # الاحتساب تلقائي دائماً، ويُحترم الخصم اليدوي فقط عند manual_deduction=true.
        manual_deduction = bool(data.get('manual_deduction'))
        computed = compute_attendance(
            settings_obj,
            obj.employee,
            obj.date,
            obj.check_in,
            obj.check_out,
            obj.status,
        )
        overtime = compute_overtime(settings_obj, obj.check_out, obj.check_in)
        obj.overtime_days = overtime['overtime_days']
        obj.overtime_hours = overtime['overtime_hours']
        obj.late_minutes = float(computed['late_minutes'] or 0)
        obj.early_minutes = float(computed['early_minutes'] or 0)

        if manual_deduction:
            if obj.is_excused and not explicit_deductions:
                obj.calculated_deduction_days = 0
                obj.calculated_deduction_hours = 0
                if data.get('review_status') is None:
                    obj.review_status = 'auto_applied'
        elif obj.is_excused:
            # تسجيل العذر يلغي الخصم المحتسب تلقائياً.
            obj.calculated_deduction_days = 0
            obj.calculated_deduction_hours = 0
            if data.get('review_status') is None:
                obj.review_status = 'auto_applied'
        elif obj.review_status == 'rejected':
            # رفض الخصم يلغي الخصم فقط (0) دون إلغاء يوم الحضور أو الإضافي.
            obj.calculated_deduction_days = 0
            obj.calculated_deduction_hours = 0
        elif obj.review_status != 'approved':
            # قرار مراجعة معتمد (قبول) لا يُستبدل بالاحتساب التلقائي.
            obj.calculated_deduction_days = computed['deduction_days']
            obj.calculated_deduction_hours = computed['deduction_hours']
            if data.get('review_status') is None:
                obj.review_status = computed['review_status']

        # يوم الإجازة الأسبوعية (من إعدادات الحضور) إجازة مدفوعة فقط عند غياب بصمة الحضور.
        # اليوم الذي سُجّلت له بصمة حضور يُعامل كيوم عمل عادي (خصم تأخير + إضافي).
        if obj.date.weekday() == weekly_off_weekday(settings_obj) and not obj.check_in:
            obj.calculated_deduction_days = 0
            obj.calculated_deduction_hours = 0
            obj.late_minutes = 0
            obj.early_minutes = 0
            if data.get('review_status') is None:
                obj.review_status = 'auto_applied'

        obj.save()
        if not manual_deduction:
            # إعادة حساب خصم يوم الإجازة الأسبوعية بعد تحديث السجل (يعتمد على سجلات الأسبوع).
            month_start, month_end = month_bounds(obj.date)
            reapply_employee_month(
                settings_obj, obj.employee, month_start, month_end,
                preserve_decisions=True,
            )
            obj.refresh_from_db()
        return Response(HRAttendanceRecordSerializer(obj).data)

    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()
        locked_err = _locked_month_error(obj.date)
        if locked_err:
            return locked_err
        return super().destroy(request, *args, **kwargs)

    # ------------------------------------------------------------------
    # شيت البصمة: تحميل القالب / رفع الشيت / الإحصاءات
    # ------------------------------------------------------------------

    @staticmethod
    def _sheet_month(request):
        value = request.query_params.get('month')
        if not value:
            data = getattr(request, 'data', None) or {}
            value = data.get('month')
        return month_bounds(value)

    @action(detail=False, methods=['get'], url_path='template')
    def download_template(self, request):
        """تحميل قالب بصمة فارغ (CSV) لكل موظف نشط خلال الشهر المطلوب."""
        month_start, month_end = self._sheet_month(request)
        settings_obj = HRAttendanceSettings.get_solo()
        employees = list(
            rank_scoped_queryset(HREmployee.objects.filter(is_active=True), request)
            .order_by('employee_code', 'name')
        )
        if not employees:
            return Response(
                {'detail': 'لا يوجد موظفون نشطون لتوليد قالب البصمة'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        content = build_template_csv(settings_obj, employees, month_start, month_end)
        filename = f'attendance_template_{month_start.strftime("%Y-%m")}.csv'
        response = HttpResponse(content.encode('utf-8'), content_type='text/csv; charset=utf-8')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response

    @action(detail=False, methods=['post'], url_path='upload-sheet')
    def upload_sheet(self, request):
        """رفع شيت بصمة (CSV/XLSX) واحتساب التأخير والغياب تلقائياً."""
        upload = (
            request.FILES.get('file')
            or request.FILES.get('sheet')
            or request.FILES.get('attachment')
        )
        if not upload:
            return Response(
                {'detail': 'لم يتم إرفاق ملف الشيت'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        filename = str(upload.name or '').strip().lower()
        if not filename.endswith(('.csv', '.xlsx', '.xls')):
            return Response(
                {'detail': 'صيغة الملف غير مدعومة. المسموح: CSV أو XLSX'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if upload.size and upload.size > 5 * 1024 * 1024:
            return Response(
                {'detail': 'حجم الملف أكبر من الحد المسموح (5 ميجابايت)'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            content = upload.read()
        except Exception:
            return Response(
                {'detail': 'تعذر قراءة الملف المرفوع'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            parsed = parse_attendance_sheet(upload.name, content)
        except Exception:
            return Response(
                {'detail': 'تعذر تحليل ملف البصمة. تأكد من تطابق الأعمدة مع القالب.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        settings_obj = HRAttendanceSettings.get_solo()
        employees = list(rank_scoped_queryset(HREmployee.objects.all(), request))
        by_code = {}
        by_name = {}
        for employee in employees:
            code = str(employee.employee_code or '').strip().casefold()
            if code:
                by_code[code] = employee
            name_key = ' '.join(str(employee.name or '').split()).casefold()
            if name_key:
                by_name.setdefault(name_key, employee)

        errors = list(parsed['errors'])
        created_count = 0
        updated_count = 0
        review_count = 0
        affected_employees = {}
        affected_employee_months = {}
        locked_months = set(
            HRPayrollSnapshot.objects.filter(is_locked=True).values_list('month', flat=True)
        )

        for row in parsed['rows']:
            row_month = row['date'].strftime('%Y-%m')
            if row_month in locked_months:
                errors.append({
                    'row': row['row'],
                    'message': f'الشهر {row_month} معتمد ومغلق ولا يمكن استيراد سجلات له',
                })
                continue

            code_key = str(row['employee_code'] or '').strip().casefold()
            name_key = ' '.join(str(row['employee_name'] or '').split()).casefold()
            employee = by_code.get(code_key) if code_key else None
            if employee is None and name_key:
                employee = by_name.get(name_key)
            if employee is None:
                errors.append({
                    'row': row['row'],
                    'message': f"الموظف غير موجود: {row['employee_code'] or row['employee_name']}",
                })
                continue

            record = HRAttendanceRecord.objects.filter(
                employee=employee, date=row['date'],
            ).first()
            if record is None:
                record = HRAttendanceRecord(employee=employee, date=row['date'])
                previous = None
                created_count += 1
                eff_in = row['check_in']
                eff_out = row['check_out']
            else:
                previous = (
                    record.check_in,
                    record.check_out,
                    record.status,
                    record.review_status,
                )
                updated_count += 1
                # إذا احتوى الصف المرفوع على بصمة واحدة فقط (حضور أو انصراف) ندمجها مع البصمة المقابلة المسجّلة مسبقاً.
                eff_in = row['check_in'] or (record.check_in if row['check_out'] else None)
                eff_out = row['check_out'] or (record.check_out if row['check_in'] else None)

            computed = compute_attendance(
                settings_obj,
                employee,
                row['date'],
                eff_in,
                eff_out,
                row['status'],
            )

            # القرار اليدوي (قبول/رفض) يُحفظ ما دامت البصمات لم تتغير.
            unchanged = previous is not None and previous[:3] == (
                eff_in, eff_out, computed['status'],
            )
            keep_decision = (
                unchanged
                and previous[3] in ('approved', 'rejected')
                and not record.is_excused
            )

            record.check_in = eff_in
            record.check_out = eff_out
            record.status = computed['status']
            if record.is_excused:
                record.calculated_deduction_days = 0
                record.calculated_deduction_hours = 0
                record.review_status = 'auto_applied'
            elif not keep_decision:
                record.calculated_deduction_days = computed['deduction_days']
                record.calculated_deduction_hours = computed['deduction_hours']
                record.review_status = computed['review_status']
            record.save()

            if record.review_status == 'pending_review':
                review_count += 1
            affected_employees[employee.pk] = employee
            affected_employee_months.setdefault(employee.pk, set()).add(
                (row['date'].year, row['date'].month)
            )

        # إعادة احتساب الإضافي وخصم يوم الإجازة الأسبوعية لكل موظف ولكل شهر متأثر بالرفع (دعم الشيتات متعددة الشهور).
        months_processed = set()
        for emp_pk, employee in affected_employees.items():
            for year_num, month_num in sorted(affected_employee_months.get(emp_pk, ())):
                m_key = f'{year_num:04d}-{month_num:02d}'
                months_processed.add(m_key)
                month_start, month_end = month_bounds(m_key)
                reapply_employee_month(
                    settings_obj, employee, month_start, month_end, preserve_decisions=True
                )

        sorted_months = sorted(months_processed)
        month_label = '، '.join(sorted_months) if sorted_months else (
            f'{parsed["rows"][0]["date"].strftime("%Y-%m")}' if parsed['rows'] else 'غير محدد'
        )
        set_audit_meta(
            request,
            section='الموارد البشرية',
            action_type='import',
            target_name=upload.name,
            details=(
                f"رفع شيت حضور الموظفين ({upload.name}) لشهر {month_label}: "
                f"جديد {created_count}، محدّث {updated_count}، أخطاء {len(errors)}"
            ),
            changes=[
                {'field': 'filename', 'label': 'ملف الشيت', 'old': '—', 'new': str(upload.name)},
                {'field': 'months', 'label': 'الشهر', 'old': '—', 'new': month_label},
                {'field': 'imported', 'label': 'سجلات مضافة', 'old': '0', 'new': str(created_count)},
                {'field': 'updated', 'label': 'سجلات محدّثة', 'old': '0', 'new': str(updated_count)},
            ],
        )
        return Response({
            'month': sorted_months[0] if sorted_months else (f'{parsed["rows"][0]["date"].strftime("%Y-%m")}' if parsed['rows'] else ''),
            'months': sorted_months,
            'filename': upload.name,
            'imported': created_count,
            'updated': updated_count,
            'processed': created_count + updated_count,
            'skipped': parsed['skipped'],
            'total_rows': parsed['total_rows'],
            'pending_review': review_count,
            'error_count': len(errors),
            'errors': errors[:50],
        })

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """إحصاءات سريعة لبطاقات أعلى شاشة الحضور والانصراف."""
        month_start, month_end = self._sheet_month(request)
        settings_obj = HRAttendanceSettings.get_solo()
        weekly_off = settings_obj.weekly_off_day or ''

        today = date.today()
        period_end = min(month_end, today)
        if period_end < month_start:
            period_end = month_start

        workdays = 0
        cursor = month_start
        while cursor <= period_end:
            if not weekly_off or cursor.strftime('%A') != weekly_off:
                workdays += 1
            cursor += timedelta(days=1)

        records = HRAttendanceRecord.objects.filter(
            date__gte=month_start,
            date__lte=month_end,
            employee__is_active=True,
            employee__rank_level__in=visible_rank_levels(get_viewer_rank(request)),
        )
        total_records = records.count()
        present = records.filter(status='present').count()
        absent = records.filter(status='absent').count()
        leave = records.filter(status='leave').count()
        missing = records.filter(status='missing_punch').count()
        pending = records.filter(review_status='pending_review').count()
        excused = records.filter(is_excused=True).count()
        late_records = records.filter(status='present', calculated_deduction_hours__gt=0).count()

        totals = records.aggregate(
            days=models.Sum('calculated_deduction_days'),
            hours=models.Sum('calculated_deduction_hours'),
        )

        by_department = {}
        for entry in records.values('employee__job__department').annotate(
            total=models.Count('id'),
            absent=models.Count('id', filter=models.Q(status='absent')),
        ):
            key = entry['employee__job__department'] or ''
            if not key:
                continue
            bucket = by_department.setdefault(key, {
                'department': key,
                'label': HR_DEPARTMENT_LABELS.get(key, key),
                'total': 0,
                'absent': 0,
            })
            bucket['total'] += entry['total'] or 0
            bucket['absent'] += entry['absent'] or 0

        worst_department = None
        for bucket in by_department.values():
            bucket['rate'] = (
                round(bucket['absent'] / bucket['total'] * 100, 1) if bucket['total'] else 0.0
            )
            if worst_department is None or bucket['absent'] > worst_department['absent']:
                worst_department = bucket

        return Response({
            'month': month_start.strftime('%Y-%m'),
            'month_start': month_start.isoformat(),
            'month_end': month_end.isoformat(),
            'workdays': workdays,
            'total_employees': HREmployee.objects.filter(
                is_active=True,
                rank_level__in=visible_rank_levels(get_viewer_rank(request)),
            ).count(),
            'total_records': total_records,
            'present': present,
            'absent': absent,
            'leave': leave,
            'missing_punch': missing,
            'excused': excused,
            'pending_review': pending,
            'late_records': late_records,
            'compliance_percent': round(present / total_records * 100, 1) if total_records else 0.0,
            'average_daily_absence': round(absent / workdays, 2) if workdays else 0.0,
            'deduction_days': round(totals['days'] or 0, 2),
            'deduction_hours': round(totals['hours'] or 0, 2),
            'worst_department': worst_department,
        })

    @action(detail=False, methods=['post'], url_path='reapply-rules')
    def reapply_rules(self, request):
        """إعادة تطبيق قواعد الحضور والإضافي وخصم يوم الإجازة الأسبوعية على سجلات شهر كامل مع حفظ قرارات المراجعة افتراضياً."""
        month_start, month_end = self._sheet_month(request)
        locked_err = _locked_month_error(month_start)
        if locked_err:
            return locked_err
        preserve = request.data.get('preserve_decisions', True)
        if isinstance(preserve, str):
            preserve = preserve.strip().lower() not in ('0', 'false', 'no')
        else:
            preserve = bool(preserve)
        settings_obj = HRAttendanceSettings.get_solo()
        employees = list(rank_scoped_queryset(HREmployee.objects.all(), request))

        changed = 0
        for employee in employees:
            changed += reapply_employee_month(
                settings_obj, employee, month_start, month_end,
                preserve_decisions=preserve,
            )

        month_str = month_start.strftime('%Y-%m')
        set_audit_meta(
            request,
            section='الموارد البشرية',
            action_type='settings',
            target_name=f'قواعد حضور شهر {month_str}',
            details=f"أعاد تطبيق قواعد الحضور لشهر {month_str} على {len(employees)} موظف (تم تحديث {changed} سجل)",
            changes=[
                {'field': 'month', 'label': 'الشهر', 'old': '—', 'new': month_str},
                {'field': 'updated', 'label': 'السجلات المحدّثة', 'old': '0', 'new': str(changed)},
            ],
        )
        return Response({
            'month': month_str,
            'month_start': month_start.isoformat(),
            'month_end': month_end.isoformat(),
            'employees': len(employees),
            'updated': changed,
            'preserve_decisions': preserve,
        })


class HRPenaltyViewSet(BasePermViewSet):
    """جزاءات الموظفين اليدوية (أيام أو ساعات)."""
    queryset = HRPenalty.objects.select_related('employee').all()
    serializer_class = HRPenaltySerializer
    permission_classes = [CanManageHR]
    required_hr_section = 'penalties'

    def get_queryset(self):
        qs = rank_scoped_queryset(
            HRPenalty.objects.select_related('employee').all(),
            self.request,
            field='employee__rank_level',
        )
        # فلترة شهرية اختيارية (YYYY-MM)؛ بدون تمرير month تبقى كل السجلات
        # متاحة للاستدعاءات العامة مثل تصدير Excel الشامل.
        month_value = self.request.query_params.get('month')
        if month_value and re.match(r'^\d{4}-\d{2}$', month_value.strip()):
            month_start, month_end = month_bounds(month_value)
            qs = qs.filter(date__gte=month_start, date__lte=month_end)
        return qs

    def create(self, request, *args, **kwargs):
        data = request.data
        employee = resolve_by_id(HREmployee, data.get('employee_id') or data.get('employee'))
        if not employee:
            return Response({'detail': 'الموظف غير موجود'}, status=status.HTTP_400_BAD_REQUEST)
        hidden = hidden_employee_error(request, employee)
        if hidden:
            return hidden
        try:
            value = float(data.get('value') or 0)
        except (TypeError, ValueError):
            return Response({'detail': 'قيمة الجزاء غير صحيحة'}, status=status.HTTP_400_BAD_REQUEST)
        if value <= 0:
            return Response({'detail': 'قيمة الجزاء يجب أن تكون أكبر من صفر'}, status=status.HTTP_400_BAD_REQUEST)
        penalty_type = data.get('penalty_type') or 'days'
        if penalty_type not in ('days', 'hours'):
            penalty_type = 'days'
        pen_date = parse_date(str(data.get('date'))) if data.get('date') else date.today()
        locked_err = _locked_month_error(pen_date or date.today())
        if locked_err:
            return locked_err
        obj = HRPenalty.objects.create(
            client_id=(data.get('id') or data.get('client_id') or None),
            employee=employee,
            date=pen_date or date.today(),
            penalty_type=penalty_type,
            value=value,
            reason=data.get('reason') or '',
        )
        return Response(HRPenaltySerializer(obj).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        obj = self.get_object()
        locked_err = _locked_month_error(obj.date)
        if locked_err:
            return locked_err
        data = request.data

        if data.get('employee_id') is not None or data.get('employee') is not None:
            employee = resolve_by_id(HREmployee, data.get('employee_id') or data.get('employee'))
            if not employee:
                return Response({'detail': 'الموظف غير موجود'}, status=status.HTTP_400_BAD_REQUEST)
            hidden = hidden_employee_error(request, employee)
            if hidden:
                return hidden
            obj.employee = employee
        if data.get('date'):
            pen_date = parse_date(str(data.get('date')))
            if pen_date:
                new_locked_err = _locked_month_error(pen_date)
                if new_locked_err:
                    return new_locked_err
                obj.date = pen_date
        if data.get('penalty_type') is not None:
            penalty_type = data.get('penalty_type') or 'days'
            if penalty_type not in ('days', 'hours'):
                penalty_type = 'days'
            obj.penalty_type = penalty_type
        if data.get('value') is not None:
            try:
                value = float(data.get('value') or 0)
            except (TypeError, ValueError):
                return Response({'detail': 'قيمة الجزاء غير صحيحة'}, status=status.HTTP_400_BAD_REQUEST)
            if value <= 0:
                return Response({'detail': 'قيمة الجزاء يجب أن تكون أكبر من صفر'}, status=status.HTTP_400_BAD_REQUEST)
            obj.value = value
        if 'reason' in data:
            obj.reason = data.get('reason') or ''
        obj.save()
        return Response(HRPenaltySerializer(obj).data)

    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()
        locked_err = _locked_month_error(obj.date)
        if locked_err:
            return locked_err
        return super().destroy(request, *args, **kwargs)


class HRLoanViewSet(BasePermViewSet):
    """سلف الموظفين المالية التي تُخصم من المرتبات."""
    queryset = HRLoan.objects.select_related('employee').all()
    serializer_class = HRLoanSerializer
    permission_classes = [CanManageHR]
    required_hr_section = 'loans'

    def get_queryset(self):
        qs = rank_scoped_queryset(
            HRLoan.objects.select_related('employee').all(),
            self.request,
            field='employee__rank_level',
        )
        # فلترة شهرية اختيارية (YYYY-MM)؛ بدون تمرير month تبقى كل السجلات
        # متاحة للاستدعاءات العامة مثل تصدير Excel الشامل.
        month_value = self.request.query_params.get('month')
        if month_value and re.match(r'^\d{4}-\d{2}$', month_value.strip()):
            month_start, month_end = month_bounds(month_value)
            qs = qs.filter(date__gte=month_start, date__lte=month_end)
        return qs

    def create(self, request, *args, **kwargs):
        data = request.data
        employee = resolve_by_id(HREmployee, data.get('employee_id') or data.get('employee'))
        if not employee:
            return Response({'detail': 'الموظف غير موجود'}, status=status.HTTP_400_BAD_REQUEST)
        hidden = hidden_employee_error(request, employee)
        if hidden:
            return hidden
        try:
            amount = float(data.get('amount') or 0)
        except (TypeError, ValueError):
            return Response({'detail': 'مبلغ السلفة غير صحيح'}, status=status.HTTP_400_BAD_REQUEST)
        if amount <= 0:
            return Response({'detail': 'مبلغ السلفة يجب أن يكون أكبر من صفر'}, status=status.HTTP_400_BAD_REQUEST)
        loan_date = parse_date(str(data.get('date'))) if data.get('date') else date.today()
        locked_err = _locked_month_error(loan_date or date.today())
        if locked_err:
            return locked_err
        obj = HRLoan.objects.create(
            client_id=(data.get('id') or data.get('client_id') or None),
            employee=employee,
            date=loan_date or date.today(),
            amount=amount,
            notes=data.get('notes') or '',
        )
        return Response(HRLoanSerializer(obj).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        obj = self.get_object()
        locked_err = _locked_month_error(obj.date)
        if locked_err:
            return locked_err
        data = request.data

        if data.get('employee_id') is not None or data.get('employee') is not None:
            employee = resolve_by_id(HREmployee, data.get('employee_id') or data.get('employee'))
            if not employee:
                return Response({'detail': 'الموظف غير موجود'}, status=status.HTTP_400_BAD_REQUEST)
            hidden = hidden_employee_error(request, employee)
            if hidden:
                return hidden
            obj.employee = employee
        if data.get('date'):
            loan_date = parse_date(str(data.get('date')))
            if loan_date:
                new_locked_err = _locked_month_error(loan_date)
                if new_locked_err:
                    return new_locked_err
                obj.date = loan_date
        if data.get('amount') is not None:
            try:
                amount = float(data.get('amount') or 0)
            except (TypeError, ValueError):
                return Response({'detail': 'مبلغ السلفة غير صحيح'}, status=status.HTTP_400_BAD_REQUEST)
            if amount <= 0:
                return Response({'detail': 'مبلغ السلفة يجب أن يكون أكبر من صفر'}, status=status.HTTP_400_BAD_REQUEST)
            obj.amount = amount
        if 'notes' in data:
            obj.notes = data.get('notes') or ''
        obj.save()
        return Response(HRLoanSerializer(obj).data)

    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()
        locked_err = _locked_month_error(obj.date)
        if locked_err:
            return locked_err
        return super().destroy(request, *args, **kwargs)


class HRPayrollSnapshotViewSet(BasePermViewSet):
    """اعتماد وإغلاق كشف المرتبات الشهري لتجميد الرواتب والقواعد وصافي المستحق."""
    queryset = HRPayrollSnapshot.objects.all()
    serializer_class = HRPayrollSnapshotSerializer
    permission_classes = [CanManageHR]
    required_hr_section = 'payroll'

    def _visible_snapshot_payload(self, request, snap: HRPayrollSnapshot):
        data = HRPayrollSnapshotSerializer(snap).data
        allowed_ranks = visible_rank_levels(get_viewer_rank(request))
        rows = [
            row for row in (data.get('rows') or [])
            if coerce_rank_level(row.get('rank_level'), DEFAULT_RANK_LEVEL) in allowed_ranks
        ]
        data['rows'] = rows
        data['totals'] = {
            'employees_count': len(rows),
            'base_salary': round(sum(float(r.get('base_salary') or 0) for r in rows), 2),
            'earned_base': round(sum(float(r.get('earned_base') or 0) for r in rows), 2),
            'overtime_pay': round(sum(float(r.get('overtime_pay') or 0) for r in rows), 2),
            'attendance_deduction': round(sum(float(r.get('attendance_deduction') or 0) for r in rows), 2),
            'penalty_deduction': round(sum(float(r.get('penalty_deduction') or 0) for r in rows), 2),
            'loan_deduction': round(sum(float(r.get('loan_deduction') or 0) for r in rows), 2),
            'total_deduction': round(sum(float(r.get('total_deduction') or 0) for r in rows), 2),
            'net_pay': round(sum(max(0.0, float(r.get('net_pay') or 0)) for r in rows), 2),
        }
        return data

    @action(detail=False, methods=['get'], url_path='for-month')
    def for_month(self, request):
        month_raw = str(request.query_params.get('month') or '').strip()
        if not re.match(r'^\d{4}-\d{2}$', month_raw):
            return Response({'detail': 'صيغة الشهر غير صحيحة (YYYY-MM)'}, status=status.HTTP_400_BAD_REQUEST)
        snap = HRPayrollSnapshot.objects.filter(month=month_raw, is_locked=True).first()
        if not snap:
            return Response({'is_locked': False, 'month': month_raw, 'snapshot': None})
        return Response({
            'is_locked': True,
            'month': month_raw,
            'snapshot': self._visible_snapshot_payload(request, snap),
        })

    @action(detail=False, methods=['post'])
    def lock(self, request):
        from .hr_reports import _payroll_for_employee_month

        month_raw = str(request.data.get('month') or '').strip()
        if not re.match(r'^\d{4}-\d{2}$', month_raw):
            return Response({'detail': 'صيغة الشهر غير صحيحة (YYYY-MM)'}, status=status.HTTP_400_BAD_REQUEST)
        if HRPayrollSnapshot.objects.filter(month=month_raw, is_locked=True).exists():
            return Response({'detail': f'شهر {month_raw} معتمد ومغلق بالفعل'}, status=status.HTTP_400_BAD_REQUEST)

        month_start, month_end = month_bounds(month_raw)
        lookup_start = month_start - timedelta(days=6)
        settings_obj = HRAttendanceSettings.get_solo()
        off_idx = weekly_off_weekday(settings_obj)

        # نحفظ كشف كل الموظفين النشطين + أي موظف غير نشط له سجلات في هذا الشهر.
        all_employees = list(HREmployee.objects.select_related('job').exclude(rank_level=RANK_SUDO).order_by('name'))
        all_att = list(HRAttendanceRecord.objects.filter(date__gte=lookup_start, date__lte=month_end))
        all_pen = list(HRPenalty.objects.filter(date__gte=month_start, date__lte=month_end))
        all_loans = list(HRLoan.objects.filter(date__gte=month_start, date__lte=month_end))

        att_by_emp = {}
        for rec in all_att:
            att_by_emp.setdefault(rec.employee_id, []).append(rec)
        pen_by_emp = {}
        for pen in all_pen:
            pen_by_emp.setdefault(pen.employee_id, []).append(pen)
        loans_by_emp = {}
        for ln in all_loans:
            loans_by_emp.setdefault(ln.employee_id, []).append(ln)

        today = date.today()
        current_month_key = today.strftime('%Y-%m')
        up_to_iso = (today - timedelta(days=1)) if month_raw == current_month_key else None

        rows_json = []
        for emp in all_employees:
            emp_att = att_by_emp.get(emp.id, [])
            emp_pen = pen_by_emp.get(emp.id, [])
            emp_loans = loans_by_emp.get(emp.id, [])
            if not emp.is_active and not (
                any(month_start <= r.date <= month_end for r in emp_att) or emp_pen or emp_loans
            ):
                continue
            rec_by_date = {r.date: r for r in emp_att}
            calc = _payroll_for_employee_month(
                emp, emp_att, rec_by_date, emp_pen, emp_loans,
                month_raw, settings_obj, up_to_iso, off_idx,
            )
            rows_json.append({
                'employee_id': get_ext_id(emp),
                'employee_code': emp.employee_code or '',
                'employee_name': emp.name,
                'job_title': emp.job.title if emp.job else '',
                'department': emp.department or '',
                'department_label': emp.department_label or '',
                'rank_level': int(emp.rank_level),
                'is_active': bool(emp.is_active),
                'base_salary': calc['base_salary'],
                'attended_days': calc['attended_days'],
                'paid_sunday_days': calc['paid_sunday_days'],
                'worked_weekly_off_days': calc['worked_weekly_off_days'],
                'weekly_off_extra_days': calc['weekly_off_extra_days'],
                'earned_days': calc['earned_days'],
                'earned_base': calc['earned_base'],
                'overtime_days': calc['overtime_days'],
                'overtime_hours': calc['overtime_hours'],
                'overtime_pay': calc['overtime_pay'],
                'attendance_days': calc['attendance_days'],
                'attendance_hours': calc['attendance_hours'],
                'attendance_deduction': calc['attendance_deduction'],
                'sunday_deduction_days': calc['sunday_deduction_days'],
                'penalty_days': calc['penalty_days'],
                'penalty_hours': calc['penalty_hours'],
                'penalty_deduction': calc['penalty_deduction'],
                'loan_deduction': calc['loan_amount'],
                'total_deduction': calc['total_deduction'],
                'net_pay': calc['net_pay'],
            })

        totals_json = {
            'employees_count': len(rows_json),
            'base_salary': round(sum(r['base_salary'] for r in rows_json), 2),
            'earned_base': round(sum(r['earned_base'] for r in rows_json), 2),
            'overtime_pay': round(sum(r['overtime_pay'] for r in rows_json), 2),
            'attendance_deduction': round(sum(r['attendance_deduction'] for r in rows_json), 2),
            'penalty_deduction': round(sum(r['penalty_deduction'] for r in rows_json), 2),
            'loan_deduction': round(sum(r['loan_deduction'] for r in rows_json), 2),
            'total_deduction': round(sum(r['total_deduction'] for r in rows_json), 2),
            'net_pay': round(sum(max(0.0, r['net_pay']) for r in rows_json), 2),
        }

        profile = resolve_request_user_profile(request)
        locker_name = (getattr(profile, 'real_name', '') or getattr(profile, 'username', '') or 'النظام') if profile else 'النظام'
        settings_snap = HRAttendanceSettingsSerializer(settings_obj).data

        snap, _ = HRPayrollSnapshot.objects.update_or_create(
            month=month_raw,
            defaults={
                'is_locked': True,
                'locked_by': locker_name,
                'settings_snapshot': settings_snap,
                'rows_json': rows_json,
                'totals_json': totals_json,
                'notes': str(request.data.get('notes') or '').strip(),
            },
        )
        set_audit_meta(
            request,
            section='الموارد البشرية',
            action_type='status_change',
            target_name=f'كشف رواتب شهر {month_raw}',
            details=(
                f"اعتمد وأغلق كشف مرتبات شهر {month_raw} ({totals_json['employees_count']} موظف، "
                f"إجمالي الصافي: {totals_json['net_pay']:g})"
            ),
            changes=[
                {'field': 'is_locked', 'label': 'حالة كشف الرواتب', 'old': 'مفتوح', 'new': 'معتمد ومغلق'},
                {'field': 'employees_count', 'label': 'عدد الموظفين', 'old': '—', 'new': str(totals_json['employees_count'])},
                {'field': 'net_pay', 'label': 'إجمالي صافي المرتبات', 'old': '—', 'new': f"{totals_json['net_pay']:g}"},
            ],
        )
        return Response({
            'is_locked': True,
            'month': month_raw,
            'snapshot': self._visible_snapshot_payload(request, snap),
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['post'])
    def unlock(self, request):
        month_raw = str(request.data.get('month') or '').strip()
        if not re.match(r'^\d{4}-\d{2}$', month_raw):
            return Response({'detail': 'صيغة الشهر غير صحيحة (YYYY-MM)'}, status=status.HTTP_400_BAD_REQUEST)
        snap = HRPayrollSnapshot.objects.filter(month=month_raw).first()
        if not snap:
            return Response({'detail': f'لا يوجد إغلاق محفوظ لشهر {month_raw}'}, status=status.HTTP_404_NOT_FOUND)
        snap.delete()
        set_audit_meta(
            request,
            section='الموارد البشرية',
            action_type='status_change',
            target_name=f'كشف رواتب شهر {month_raw}',
            details=f"أعاد فتح كشف مرتبات شهر {month_raw} للتعديل",
            changes=[
                {'field': 'is_locked', 'label': 'حالة كشف الرواتب', 'old': 'معتمد ومغلق', 'new': 'مفتوح'},
            ],
        )
        return Response({'is_locked': False, 'month': month_raw, 'status': 'unlocked'})


# ---------------------------------------------------------------------------
# تصفير بيانات المصنع الانتقائي (Factory Reset) — مخصص لحساب sudo فقط
# ---------------------------------------------------------------------------
