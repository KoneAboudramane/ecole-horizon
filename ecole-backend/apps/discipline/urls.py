from django.urls import path

from . import conduct_views as cv
from . import views

urlpatterns = [
    path("incidents/", views.IncidentList.as_view()),
    path("incidents/<int:pk>/decide/", views.DecideIncidentView.as_view()),
    path("educators/", cv.EducatorsView.as_view()),
    path("educators/mine/", cv.MyClassesView.as_view()),
    path("educators/<int:pk>/classes/", cv.EducatorClassesView.as_view()),
    path("conduct/", cv.ConductView.as_view()),
    path("conduct/deductions/", cv.DeductionCreate.as_view()),
    path("conduct/deductions/<int:pk>/", cv.DeductionDelete.as_view()),
    path("conduct/absences/apply/", cv.ApplyAbsencesView.as_view()),
    path("conduct/publish/", cv.PublishConductView.as_view()),
]
