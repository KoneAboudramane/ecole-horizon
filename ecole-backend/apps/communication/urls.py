from django.urls import path

from . import views

urlpatterns = [
    path("announcements/", views.AnnouncementList.as_view()),
    path("messages/recipients/", views.RecipientsView.as_view()),
    path("messages/unread-count/", views.MsgUnread.as_view()),
    path("messages/threads/", views.ThreadList.as_view()),
    path("messages/threads/<int:pk>/", views.ThreadDetail.as_view()),
    path("messages/threads/<int:pk>/reply/", views.ReplyView.as_view()),
    path("messages/threads/<int:pk>/read/", views.ReadView.as_view()),
]
