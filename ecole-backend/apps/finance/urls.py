from django.urls import path

from . import views

urlpatterns = [
    path("finance/tarifs/", views.TarifView.as_view()),
    path("finance/reports/", views.ReportsView.as_view()),
    path("finance/tranches/", views.TranchesView.as_view()),
    path("finance/dates/", views.FeeDateView.as_view()),
    path("finance/overview/", views.OverviewView.as_view()),
    path("finance/overdue/", views.OverdueView.as_view()),
    path("finance/students/<int:pk>/account/", views.AccountView.as_view()),
    path("finance/accounts/", views.AccountsView.as_view()),
    path("finance/payments/", views.PaymentList.as_view()),
    path("finance/payments/import/", views.PaymentImportView.as_view()),
    path("finance/payments/import/modele/", views.PaymentImportTemplateView.as_view()),
    path("finance/payments/<int:pk>/cancel/", views.CancelView.as_view()),
    path("finance/payments/<int:pk>/receipt/", views.ReceiptView.as_view()),
    path("finance/payments/<int:pk>/receipt.pdf", views.ReceiptPdfView.as_view()),
    path("finance/years/", views.YearsView.as_view()),
    path("finance/students/<int:pk>/statement/", views.StudentStatementView.as_view()),
    path("finance/cash/", views.CashView.as_view()),
    path("finance/cash/close/", views.CashCloseView.as_view()),
    path("finance/reminders/", views.ReminderView.as_view()),
    path("finance/statement/", views.StatementList.as_view()),
    path("finance/statement/import/", views.StatementImport.as_view()),
    path("finance/statement/<int:pk>/match/", views.StatementMatch.as_view()),
    path("finance/statement/<int:pk>/fix/", views.StatementFix.as_view()),
    path("finance/pay/initiate/", views.InitiateView.as_view()),
    path("finance/pay/<uuid:reference>/", views.IntentStatus.as_view()),
    path("finance/pay/<uuid:reference>/sandbox-confirm/", views.SandboxConfirm.as_view()),
    path("webhooks/mobile-money/", views.MobileMoneyWebhook.as_view()),
]
