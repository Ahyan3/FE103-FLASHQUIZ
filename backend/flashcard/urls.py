from django.urls import path
from .views import (
    SignupView, 
    LoginView, 
    CurrentUserView,
    SyncView,
    InitialSyncView,
    # File generation views
    GenerateFlashcardsFromFileView,
    ListFileGenerationJobsView,
    FileGenerationJobDetailView,
    # Internet sharing views
    CreateShareLinkView,
    ListShareLinksView,
    DeleteShareLinkView,
    AccessSharedSetView,
    CopySharedSetView,
    ListSharedSetsView,
    SearchSharedSetsView,
    # Bluetooth sharing views
    InitiateBluetoothShareView,
    AcceptBluetoothShareView,
    CompleteBluetoothShareView,
    CancelBluetoothShareView,
    BluetoothShareStatusView,
    ListActiveBluetoothSharesView,
    UpdateSetProgressView,
    RecordStudySessionView,
    GetLatestQuizSessionView
)

urlpatterns = [
    # ==================== Auth endpoints ====================
    path("signup/", SignupView.as_view(), name='signup'),
    path("login/", LoginView.as_view(), name='login'),
    path("me/", CurrentUserView.as_view(), name='current-user'),
    
    # ==================== Sync endpoints ====================
    path("sync/", SyncView.as_view(), name='sync'),
    path("sync/initial/", InitialSyncView.as_view(), name='initial-sync'),
    
    # ==================== File Generation ====================
    path("generate/from-file/", GenerateFlashcardsFromFileView.as_view(), name='generate-from-file'),
    path("generate/jobs/", ListFileGenerationJobsView.as_view(), name='list-generation-jobs'),
    path("generate/jobs/<str:id>/", FileGenerationJobDetailView.as_view(), name='generation-job-detail'),
    
    # ==================== Internet Sharing ====================
    # Create and manage share links
    path("share/create/", CreateShareLinkView.as_view(), name='create-share-link'),
    path("share/links/", ListShareLinksView.as_view(), name='list-share-links'),
    path("share/<str:share_code>/delete/", DeleteShareLinkView.as_view(), name='delete-share-link'),
    
    # Access shared sets
    path("share/access/", AccessSharedSetView.as_view(), name='access-shared-set'),
    path("share/copy/", CopySharedSetView.as_view(), name='copy-shared-set'),
    
    # Discover shared sets from peers
    path("shared-sets/", ListSharedSetsView.as_view(), name='list-shared-sets'),
    path("shared-sets/search/", SearchSharedSetsView.as_view(), name='search-shared-sets'),
    
    # ==================== Bluetooth Sharing ====================
    # Initiate and manage Bluetooth shares
    path("bluetooth/initiate/", InitiateBluetoothShareView.as_view(), name='initiate-bluetooth'),
    path("bluetooth/accept/", AcceptBluetoothShareView.as_view(), name='accept-bluetooth'),
    path("bluetooth/<str:session_code>/complete/", CompleteBluetoothShareView.as_view(), name='complete-bluetooth'),
    path("bluetooth/<str:session_code>/cancel/", CancelBluetoothShareView.as_view(), name='cancel-bluetooth'),
    path("bluetooth/<str:session_code>/status/", BluetoothShareStatusView.as_view(), name='bluetooth-status'),
    path("bluetooth/active/", ListActiveBluetoothSharesView.as_view(), name='list-active-bluetooth'),
    path("sets/<str:set_id>/update-progress/", UpdateSetProgressView.as_view(), name='update-set-progress'),
    path("sets/<str:set_id>/record-session/", RecordStudySessionView.as_view(), name='record-study-session'),
    path('sets/<str:set_id>/latest-quiz/', GetLatestQuizSessionView.as_view(), name='latest-quiz-session'),
]