from django.urls import path

from . import principal, views

urlpatterns = [
    path("evaluations/", views.EvaluationList.as_view()),
    path("evaluations/publish/", views.PublishView.as_view()),
    path("evaluations/schedule/", views.ScheduleView.as_view()),
    path("evaluations/<int:pk>/", views.EvaluationDetail.as_view()),
    path("evaluations/<int:pk>/grades/", views.EvaluationGrades.as_view()),
    path("overview/", views.OverviewView.as_view()),
    path("archives/", views.ArchiveView.as_view()),
    path("results/", views.ClassResultsView.as_view()),
    path("students/<int:pk>/bulletin/", views.BulletinView.as_view()),
    path("students/<int:pk>/bulletin.pdf", views.BulletinPdfView.as_view()),
    path("students/<int:pk>/bulletin-access/", views.BulletinAccessView.as_view()),
    path("classes/<int:pk>/bulletins.pdf", views.ClassBulletinsPdfView.as_view()),
    path("public/verify/<str:token>/", views.VerifyBulletinView.as_view()),
    path("students/<int:pk>/grades/", views.StudentGradesView.as_view()),
    path("appreciations/", views.AppreciationView.as_view()),
    path("council/", views.CouncilView.as_view()),
    path("principal/", principal.MyClassesView.as_view()),
    path("principal/<int:pk>/", principal.MyClassView.as_view()),
    path("decisions/", views.DecisionView.as_view()),
]
