from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from . import rolesapi, views

urlpatterns = [
    path("auth/login/", views.LoginView.as_view(), name="login"),
    path("auth/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("auth/forgot-password/", views.ForgotPasswordView.as_view(), name="forgot-password"),
    path("auth/reset-password/", views.ResetPasswordConfirmView.as_view(), name="reset-password-confirm"),
    path("auth/logout/", views.LogoutView.as_view(), name="logout"),
    path("auth/captcha/", views.CaptchaView.as_view(), name="captcha"),
    path("auth/2fa/", views.TwoFactorView.as_view(), name="2fa"),
    path("auth/2fa/activer/", views.TwoFactorEnableView.as_view(), name="2fa-enable"),
    path("auth/2fa/desactiver/", views.TwoFactorDisableView.as_view(), name="2fa-disable"),
    path("me/", views.MeView.as_view(), name="me"),
    path("me/photo/", views.PhotoView.as_view(), name="me-photo"),
    path("me/password/", views.PasswordView.as_view(), name="me-password"),
    path("roles/", rolesapi.RoleList.as_view(), name="roles"),
    path("roles/choices/", rolesapi.RoleChoices.as_view(), name="role-choices"),
    path("roles/<int:pk>/", rolesapi.RoleDetail.as_view(), name="role-detail"),
    path("users/import/", views.StaffImportView.as_view()),
    path("users/import/modele/", views.StaffImportTemplateView.as_view()),
    path("users/", views.UserListCreateView.as_view(), name="users"),
    path("users/<int:pk>/", views.UserDetailView.as_view(), name="user-detail"),
    path("users/<int:pk>/reset-password/", views.ResetPasswordView.as_view(), name="user-reset"),
    path("users/<int:pk>/toggle-active/", views.ToggleActiveView.as_view(), name="user-toggle"),
]
