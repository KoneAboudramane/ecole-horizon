from django.urls import path

from . import views

urlpatterns = [
    path("timetable/", views.TimetableView.as_view()),
    path("timetable/generate/", views.GenerateView.as_view()),
    path("timetable/horaires/", views.HorairesView.as_view()),
    path("timetable/dispo/", views.DispoView.as_view()),
    path("timetable/dispo/remind/", views.DispoRemind.as_view()),
    path("timetable/dispo/<int:pk>/", views.DispoDetail.as_view()),
    path("lessons/", views.LessonsView.as_view()),
    path("replacements/", views.ReplacementList.as_view()),
    path("replacements/candidates/", views.CandidatesView.as_view()),
    path("replacements/<int:pk>/", views.ReplacementDetail.as_view()),
    path("rooms/", views.RoomList.as_view()),
    path("rooms/auto/", views.RoomAutoView.as_view()),
    path("rooms/<int:pk>/", views.RoomDetail.as_view()),
    path("textbook/last/", views.TextbookLast.as_view()),
    path("textbook/", views.TextbookList.as_view()),
    path("textbook/<int:pk>/", views.TextbookDetail.as_view()),
]
