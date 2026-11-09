from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    AuthViewSet, StateViewSet, GlobalSettingsViewSet,
    RoleViewSet, UserProfileViewSet, SizeDefViewSet, SupplierViewSet,
    FabricViewSet, FabricColorViewSet, FabricTransactionViewSet,
    AccessoryTypeViewSet, AccessoryViewSet, AccessoryTransactionViewSet,
    ModelItemViewSet, ModelRequirementViewSet, ModelAccessoryViewSet,
    CuttingRecordViewSet, QCRecordViewSet, PrintDispatchViewSet,
    SewingDispatchViewSet, NotificationViewSet, InternalMessageViewSet,
    AuditLogViewSet, ReportsViewSet,
    HRJobTitleViewSet, HREmployeeViewSet, HRAttendanceSettingsViewSet,
    HRAttendanceRecordViewSet, HRPenaltyViewSet, HRLoanViewSet
)

router = DefaultRouter()
router.register(r'auth', AuthViewSet, basename='auth')
router.register(r'state', StateViewSet, basename='state')
router.register(r'global-settings', GlobalSettingsViewSet, basename='global-settings')
router.register(r'roles', RoleViewSet)
router.register(r'users', UserProfileViewSet)
router.register(r'sizes', SizeDefViewSet)
router.register(r'suppliers', SupplierViewSet)
router.register(r'fabrics', FabricViewSet)
router.register(r'fabric-colors', FabricColorViewSet)
router.register(r'fabric-transactions', FabricTransactionViewSet)
router.register(r'accessory-types', AccessoryTypeViewSet)
router.register(r'accessories', AccessoryViewSet)
router.register(r'accessory-transactions', AccessoryTransactionViewSet)
router.register(r'models', ModelItemViewSet)
router.register(r'model-requirements', ModelRequirementViewSet)
router.register(r'model-accessories', ModelAccessoryViewSet)
router.register(r'cutting-records', CuttingRecordViewSet)
router.register(r'qc-records', QCRecordViewSet)
router.register(r'dispatches', PrintDispatchViewSet)
router.register(r'sewing-dispatches', SewingDispatchViewSet)
router.register(r'notifications', NotificationViewSet, basename='notifications')
router.register(r'internal-messages', InternalMessageViewSet, basename='internal-messages')
router.register(r'audit-logs', AuditLogViewSet)
router.register(r'reports', ReportsViewSet, basename='reports')
router.register(r'hr-job-titles', HRJobTitleViewSet, basename='hr-job-titles')
router.register(r'hr-employees', HREmployeeViewSet, basename='hr-employees')
router.register(r'hr-attendance-settings', HRAttendanceSettingsViewSet, basename='hr-attendance-settings')
router.register(r'hr-attendance-records', HRAttendanceRecordViewSet, basename='hr-attendance-records')
router.register(r'hr-penalties', HRPenaltyViewSet, basename='hr-penalties')
router.register(r'hr-loans', HRLoanViewSet, basename='hr-loans')

urlpatterns = [
    path('', include(router.urls)),
]
