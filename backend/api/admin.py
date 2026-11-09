from django.contrib import admin
from .models import (
    SystemSetting, GlobalSettings, Role, UserProfile, SizeDef, Supplier,
    Fabric, FabricColor, FabricTransaction,
    AccessoryType, Accessory, AccessoryTransaction,
    ModelItem, ModelRequirement, ModelAccessory, ModelTimeline,
    CuttingRecord, CuttingSpreadLayer, QCRecord, PrintDispatch,
    SewingDispatch, AppNotification, InternalMessage, AuditLog,
    HRJobTitle, HREmployee, HRAttendanceSettings,
    HRAttendanceRecord, HRPenalty, HRLoan
)


@admin.register(SystemSetting)
class SystemSettingAdmin(admin.ModelAdmin):
    list_display = ('key', 'updated_at')


@admin.register(GlobalSettings)
class GlobalSettingsAdmin(admin.ModelAdmin):
    list_display = ('site_name', 'copyright_text', 'updated_by', 'updated_at')


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ('name', 'client_id', 'description', 'created_at')


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ('username', 'real_name', 'role', 'is_sudo', 'is_active', 'last_active')
    list_filter = ('is_sudo', 'is_active', 'role')


@admin.register(SizeDef)
class SizeDefAdmin(admin.ModelAdmin):
    list_display = ('name', 'values', 'created_at')


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = ('name', 'phone', 'created_at')


@admin.register(Fabric)
class FabricAdmin(admin.ModelAdmin):
    list_display = ('name', 'unit', 'supplier_id_ref', 'created_at')
    search_fields = ('name',)


@admin.register(FabricColor)
class FabricColorAdmin(admin.ModelAdmin):
    list_display = ('fabric', 'color_code', 'color_name', 'quantity', 'reserved_quantity', 'price_per_unit')


@admin.register(FabricTransaction)
class FabricTransactionAdmin(admin.ModelAdmin):
    list_display = ('fabric', 'color', 'operation', 'amount', 'model_code_ref', 'timestamp')


@admin.register(AccessoryType)
class AccessoryTypeAdmin(admin.ModelAdmin):
    list_display = ('name', 'description')


@admin.register(Accessory)
class AccessoryAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'type_name', 'usage_type', 'current_stock', 'min_threshold', 'custom_model_code')
    list_filter = ('usage_type', 'withdrawn_for_model')


@admin.register(AccessoryTransaction)
class AccessoryTransactionAdmin(admin.ModelAdmin):
    list_display = ('accessory_code', 'accessory_name', 'operation', 'amount', 'model_code_ref', 'timestamp')


@admin.register(ModelItem)
class ModelItemAdmin(admin.ModelAdmin):
    list_display = ('model_code', 'model_type', 'status', 'target_cut_quantity', 'total_cut_pieces')
    list_filter = ('status', 'model_type')
    search_fields = ('model_code',)


@admin.register(ModelRequirement)
class ModelRequirementAdmin(admin.ModelAdmin):
    list_display = ('model', 'color', 'part_name', 'planned_quantity')


@admin.register(ModelAccessory)
class ModelAccessoryAdmin(admin.ModelAdmin):
    list_display = ('model', 'accessory_name', 'target_type', 'planned_quantity', 'unit')


class CuttingSpreadLayerInline(admin.TabularInline):
    model = CuttingSpreadLayer
    extra = 1


@admin.register(CuttingRecord)
class CuttingRecordAdmin(admin.ModelAdmin):
    list_display = ('model', 'spread_number', 'spreader_name', 'cutter_name', 'layers_count', 'pieces_per_layer', 'layer_weight', 'pieces_count', 'created_at')
    inlines = [CuttingSpreadLayerInline]


@admin.register(CuttingSpreadLayer)
class CuttingSpreadLayerAdmin(admin.ModelAdmin):
    list_display = ('spread', 'color_name', 'layers_count', 'layer_weight', 'pieces_count')


@admin.register(QCRecord)
class QCRecordAdmin(admin.ModelAdmin):
    list_display = ('model', 'stage', 'color_name', 'size', 'counted_pieces', 'defect_pieces', 'checked_by')
    list_filter = ('stage', 'color_name', 'size')


@admin.register(PrintDispatch)
class PrintDispatchAdmin(admin.ModelAdmin):
    list_display = ('model', 'print_house', 'pieces_count', 'status', 'expected_delivery_date')


@admin.register(SewingDispatch)
class SewingDispatchAdmin(admin.ModelAdmin):
    list_display = ('model', 'workshop_name', 'piece_type', 'pieces_count', 'status')


@admin.register(InternalMessage)
class InternalMessageAdmin(admin.ModelAdmin):
    list_display = ('sender', 'receiver', 'content', 'is_read', 'created_at')


@admin.register(AppNotification)
class AppNotificationAdmin(admin.ModelAdmin):
    list_display = ('title', 'urgency', 'stage', 'model', 'expected_date')


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ('action', 'user_name', 'details', 'ip_address', 'timestamp')


@admin.register(HRJobTitle)
class HRJobTitleAdmin(admin.ModelAdmin):
    list_display = ('title', 'department', 'client_id', 'created_at')
    list_filter = ('department',)
    search_fields = ('title',)


@admin.register(HREmployee)
class HREmployeeAdmin(admin.ModelAdmin):
    list_display = ('employee_code', 'name', 'job', 'monthly_salary', 'rule_application_mode', 'is_active')
    list_filter = ('is_active', 'rule_application_mode', 'job__department')
    search_fields = ('employee_code', 'name', 'national_id', 'phone')


@admin.register(HRAttendanceSettings)
class HRAttendanceSettingsAdmin(admin.ModelAdmin):
    list_display = ('official_start_time', 'official_end_time', 'weekly_off_day', 'month_calculation_days', 'updated_at')


@admin.register(HRAttendanceRecord)
class HRAttendanceRecordAdmin(admin.ModelAdmin):
    list_display = ('employee', 'date', 'check_in', 'check_out', 'status', 'review_status')
    list_filter = ('status', 'review_status')


@admin.register(HRPenalty)
class HRPenaltyAdmin(admin.ModelAdmin):
    list_display = ('employee', 'date', 'penalty_type', 'value')
    list_filter = ('penalty_type',)


@admin.register(HRLoan)
class HRLoanAdmin(admin.ModelAdmin):
    list_display = ('employee', 'date', 'amount')
    search_fields = ('employee__name', 'employee__employee_code')