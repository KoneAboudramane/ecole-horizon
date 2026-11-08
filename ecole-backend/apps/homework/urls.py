from django.urls import path

from . import resources, views

urlpatterns = [
    path("homeworks/", views.AssignmentList.as_view()),
    path("homeworks/<int:pk>/", views.AssignmentDetail.as_view()),
    path("homeworks/<int:pk>/questions/", views.QuestionsView.as_view()),
    path("homeworks/<int:pk>/send/", views.SendView.as_view()),
    path("homeworks/<int:pk>/attachment/", views.AttachmentView.as_view()),
    path("homeworks/<int:pk>/submit/", views.SubmitView.as_view()),
    path("homeworks/<int:pk>/start/", views.AttemptView.as_view()),
    path("homeworks/<int:pk>/answers/", views.AnswersView.as_view()),
    path("homeworks/<int:pk>/leave/", views.LeaveView.as_view()),
    path("homeworks/<int:pk>/finish/", views.FinishView.as_view()),
    path("homeworks/<int:pk>/submissions/", views.SubmissionsView.as_view()),
    path("homeworks/<int:pk>/grades/", views.GradesView.as_view()),
    path("homeworks/<int:pk>/correction/", views.CorrectionView.as_view()),
    path("homeworks/<int:pk>/to-grades/", views.ToGradesView.as_view()),
    path("submissions/<int:pk>/", views.SubmissionDetail.as_view()),
    path("submissions/<int:pk>/file/", views.SubmissionFile.as_view()),
    path("resources/", resources.ResourceList.as_view()),
    path("resources/<int:pk>/", resources.ResourceDetail.as_view()),
    path("resources/<int:pk>/file/", resources.ResourceFile.as_view()),
]
