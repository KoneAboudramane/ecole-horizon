from django.urls import path

from . import views

urlpatterns = [
    path("mock-exams/", views.SessionList.as_view()),
    path("mock-exam-types/", views.ExamTypeList.as_view()),
    path("mock-exam-types/<int:pk>/", views.ExamTypeDetail.as_view()),
    path("mock-exams/<int:pk>/", views.SessionDetail.as_view()),
    path("mock-exams/<int:pk>/results/", views.ResultsView.as_view()),
    path("mock-exams/<int:pk>/marks/", views.MarksView.as_view()),
    path("mock-exams/<int:pk>/publish/", views.PublishView.as_view()),
]
