from django.urls import path

from . import rollover_views, views

urlpatterns = [
    path("students/", views.StudentListCreate.as_view()),
    path("students/import/", views.ImportView.as_view()),
    path("students/import/modele/", views.ImportTemplateView.as_view()),
    path("students/export/", views.ExportView.as_view()),
    path("students/<int:pk>/", views.StudentDetail.as_view()),
    path("students/<int:pk>/cursus/", views.StudentOtherCursusView.as_view()),
    path("students/<int:pk>/reintegrate/", rollover_views.ReintegrateView.as_view()),
    path("rollover/plan/", rollover_views.RolloverPlanView.as_view()),
    path("rollover/apply/", rollover_views.RolloverApplyView.as_view()),
    path("rollover/undo/", rollover_views.RolloverUndoView.as_view()),
    path("rollover/placement/", rollover_views.PlacementView.as_view()),
    path("rollover/placement/suggest/", rollover_views.PlacementSuggestView.as_view()),
    path("rollover/reinscription/", rollover_views.ReinscriptionView.as_view()),
    path("rollover/departs/", rollover_views.DepartedView.as_view()),
    path("parents/", views.ParentList.as_view()),
]
