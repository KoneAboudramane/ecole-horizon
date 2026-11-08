from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register("classes", views.ClassViewSet, basename="class")
router.register("subjects", views.SubjectViewSet, basename="subject")

urlpatterns = [
    path("classes/import/", views.ClassImportView.as_view()),
    path("classes/<int:pk>/principal/", views.PrincipalSetView.as_view()),
    path("classes/import/modele/", views.ClassImportTemplateView.as_view()),
    path("subjects/import/", views.SubjectImportView.as_view()),
    path("subjects/import/modele/", views.SubjectImportTemplateView.as_view()),
] + router.urls + [
    path("settings/", views.SettingsView.as_view()),
    path("public/school/", views.PublicSchoolView.as_view()),
    path("calendar/", views.CalendarView.as_view()),
    path("cursus/", views.CursusList.as_view()),
    path("cursus/<int:pk>/classes/", views.CursusClasses.as_view()),
    path("calendar/periodes/", views.PeriodesView.as_view()),
    path("terms/<int:pk>/lock/", views.TermLockView.as_view()),
    path("coefficients/", views.CoefficientView.as_view()),
    path("levels/", views.LevelList.as_view()),
    path("levels/order/", views.LevelOrder.as_view()),
    path("levels/<int:pk>/", views.LevelDetail.as_view()),
    path("series/", views.SerieList.as_view()),
    path("series/<int:pk>/", views.SerieDetail.as_view()),
    path("teachers/", views.TeacherListView.as_view()),
    path("teachers/<int:pk>/", views.TeacherDetailView.as_view()),
    path("assignments/", views.AssignmentView.as_view()),
    path("assignments/repartition/", views.RepartitionView.as_view()),
]
