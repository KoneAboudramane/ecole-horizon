from django.urls import path

from . import views

urlpatterns = [
    path("attendance/appel/", views.AppelView.as_view()),
    path("attendance/sessions/", views.SessionsView.as_view()),
    path("attendance/suivi/", views.SuiviView.as_view()),
    path("absences/", views.AbsenceList.as_view()),
    path("absences/<int:pk>/justify/", views.JustifyView.as_view()),
    path("absences/<int:pk>/decide/", views.DecideJustifView.as_view()),
    path("absences/<int:pk>/record/", views.RecordJustifView.as_view()),
    path("students/<int:pk>/attendance/", views.SummaryView.as_view()),
]
