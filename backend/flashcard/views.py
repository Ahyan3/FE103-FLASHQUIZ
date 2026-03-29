from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework_simplejwt.tokens import RefreshToken
from django.utils import timezone
from django.db import transaction
from django.db.models import Count, Q, F
from datetime import timedelta
from django.shortcuts import get_object_or_404
import uuid
import io

from .serializers import (
    SignupSerializer, LoginSerializer, UserSerializer,
    CategorySerializer, FlashcardSetSerializer, FlashcardSerializer,
    StudySessionSerializer, CardProgressSerializer, SetProgressSerializer,
    # Sharing serializers
    ShareLinkSerializer, CreateShareLinkSerializer,
    SharedSetAccessSerializer, BluetoothShareSerializer,
    InitiateBluetoothShareSerializer, AcceptBluetoothShareSerializer,
    AccessSharedSetSerializer,
    # File generation serializers
    FileGenerationJobSerializer, GenerateFlashcardsFromFileSerializer
)
from .models import (
    Category, FlashcardSet, Flashcard,
    StudySession, CardProgress, SetProgress,
    # Sharing models
    ShareLink, SharedSetAccess, BluetoothShare,
    # File generation model
    FileGenerationJob
)

# Import file extraction and AI generation utilities
from .file_extractors import extract_text_from_file, get_file_type_from_filename
from .ai_generator import generate_flashcards_with_retry

# ==================== AUTH ====================

class SignupView(generics.CreateAPIView):
    serializer_class = SignupSerializer
    permission_classes = [AllowAny]


class LoginView(generics.GenericAPIView):
    serializer_class = LoginSerializer
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data["user"]

        refresh = RefreshToken.for_user(user)

        return Response({
            "user": UserSerializer(user).data,
            "access": str(refresh.access_token),
            "refresh": str(refresh),
        })


class CurrentUserView(generics.RetrieveAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user


# ==================== SYNC ====================

class SyncView(APIView):
    """
    Full bidirectional sync (offline-first)
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user = request.user
        last_sync = request.data.get("last_sync")
        sync_timestamp = timezone.now()

        with transaction.atomic():
            categories = self._sync_categories(user, request.data.get("categories", []), last_sync)
            sets = self._sync_sets(user, request.data.get("flashcard_sets", []), last_sync)
            sessions = self._sync_sessions(user, request.data.get("study_sessions", []), last_sync)
            card_progress = self._sync_card_progress(user, request.data.get("card_progress", []), last_sync)
            set_progress = self._sync_set_progress(user, request.data.get("set_progress", []), last_sync)

        return Response({
            "categories": CategorySerializer(categories, many=True).data,
            "flashcard_sets": FlashcardSetSerializer(sets, many=True).data,
            "study_sessions": StudySessionSerializer(sessions, many=True).data,
            "card_progress": CardProgressSerializer(card_progress, many=True).data,
            "set_progress": SetProgressSerializer(set_progress, many=True).data,
            "sync_timestamp": sync_timestamp.isoformat()
        })

    # ---------- Categories ----------

    def _sync_categories(self, user, client_data, last_sync):
        for data in client_data:
            obj, created = Category.objects.get_or_create(
                id=data["id"], user=user,
                defaults={"name": data["name"]}
            )
            if not created and data["updated_at"] > obj.updated_at.isoformat():
                obj.name = data["name"]
                obj.save()

        qs = Category.objects.filter(user=user)
        return qs.filter(updated_at__gt=last_sync) if last_sync else qs

    # ---------- Flashcard Sets + Cards ----------

    def _sync_sets(self, user, client_data, last_sync):
        for data in client_data:
            obj, created = FlashcardSet.objects.get_or_create(
                id=data["id"], user=user,
                defaults={
                    "title": data.get("title", "Untitled"),
                    "category": data.get("category"),
                    "is_deleted": data.get("is_deleted", False),
                }
            )

            if not created and data["updated_at"] > obj.updated_at.isoformat():
                obj.title = data.get("title", obj.title)
                obj.category = data.get("category")
                obj.is_deleted = data.get("is_deleted", False)
                obj.save()

            self._sync_cards(obj, data.get("cards", []))

        qs = FlashcardSet.objects.filter(user=user).prefetch_related("cards")
        return qs.filter(updated_at__gt=last_sync) if last_sync else qs

    def _sync_cards(self, flashcard_set, client_cards):
        for data in client_cards:
            obj, created = Flashcard.objects.get_or_create(
                id=data["id"], flashcard_set=flashcard_set,
                defaults={
                    "question": data.get("question", ""),
                    "answer": data.get("answer", ""),
                    "position": data.get("position", 0),
                    "is_deleted": data.get("is_deleted", False),
                }
            )

            if not created and data["updated_at"] > obj.updated_at.isoformat():
                obj.question = data.get("question", obj.question)
                obj.answer = data.get("answer", obj.answer)
                obj.position = data.get("position", obj.position)
                obj.is_deleted = data.get("is_deleted", False)
                obj.save()

    # ---------- Study Sessions ----------

    def _sync_sessions(self, user, client_data, last_sync):
        for data in client_data:
            flashcard_set = FlashcardSet.objects.filter(
                id=data["flashcard_set_id"], user=user
            ).first()
            if not flashcard_set:
                continue

            obj, created = StudySession.objects.get_or_create(
                id=data["id"], user=user, flashcard_set=flashcard_set,
                defaults=data
            )

            if not created and data["updated_at"] > obj.updated_at.isoformat():
                for field in data:
                    setattr(obj, field, data[field])
                obj.save()

        qs = StudySession.objects.filter(user=user)
        return qs.filter(updated_at__gt=last_sync) if last_sync else qs

    # ---------- Card Progress ----------

    def _sync_card_progress(self, user, client_data, last_sync):
        for data in client_data:
            flashcard = Flashcard.objects.filter(id=data["flashcard_id"]).first()
            if not flashcard:
                continue

            obj, created = CardProgress.objects.get_or_create(
                id=data["id"], user=user, flashcard=flashcard,
                defaults=data
            )

            if not created and data["updated_at"] > obj.updated_at.isoformat():
                for field in data:
                    setattr(obj, field, data[field])
                obj.save()

        qs = CardProgress.objects.filter(user=user)
        return qs.filter(updated_at__gt=last_sync) if last_sync else qs

    # ---------- Set Progress ----------

    def _sync_set_progress(self, user, client_data, last_sync):
        for data in client_data:
            flashcard_set = FlashcardSet.objects.filter(
                id=data["flashcard_set_id"], user=user
            ).first()
            if not flashcard_set:
                continue

            obj, created = SetProgress.objects.get_or_create(
                id=data["id"], user=user, flashcard_set=flashcard_set,
                defaults=data
            )

            if not created and data["updated_at"] > obj.updated_at.isoformat():
                for field in data:
                    setattr(obj, field, data[field])
                obj.save()

        qs = SetProgress.objects.filter(user=user)
        return qs.filter(updated_at__gt=last_sync) if last_sync else qs


# ==================== INITIAL SYNC ====================

class InitialSyncView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        return Response({
            "categories": CategorySerializer(Category.objects.filter(user=user), many=True).data,
            "flashcard_sets": FlashcardSetSerializer(
                FlashcardSet.objects.filter(user=user).prefetch_related("cards"),
                many=True
            ).data,
            "study_sessions": StudySessionSerializer(StudySession.objects.filter(user=user), many=True).data,
            "card_progress": CardProgressSerializer(CardProgress.objects.filter(user=user), many=True).data,
            "set_progress": SetProgressSerializer(SetProgress.objects.filter(user=user), many=True).data,
            "sync_timestamp": timezone.now().isoformat()
        })

# ==================== FILE GENERATION FROM DOCUMENTS ====================

class GenerateFlashcardsFromFileView(APIView):
    """
    Upload a document (PDF, DOCX, PPTX) and generate flashcards using AI
    """
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]
    
    def post(self, request):
        serializer = GenerateFlashcardsFromFileSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        uploaded_file = serializer.validated_data['file']
        num_cards = serializer.validated_data.get('num_cards', 20)
        category = serializer.validated_data.get('category')
        
        filename = uploaded_file.name
        file_size = uploaded_file.size
        
        # Validate file type
        file_type = get_file_type_from_filename(filename)
        if not file_type:
            return Response(
                {'error': 'Unsupported file type. Please upload PDF, DOCX, or PPTX files.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Validate file size (max 10MB)
        max_size = 10 * 1024 * 1024  # 10MB
        if file_size > max_size:
            return Response(
                {'error': f'File too large. Maximum size is 10MB, received {file_size / (1024 * 1024):.1f}MB'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Create job record
        job_id = str(uuid.uuid4())
        job = FileGenerationJob.objects.create(
            id=job_id,
            user=request.user,
            filename=filename,
            file_type=file_type,
            file_size=file_size,
            status='processing'
        )
        
        try:
            # Extract text from file
            file_content = uploaded_file.read()
            file_obj = io.BytesIO(file_content)
            
            try:
                text_content = extract_text_from_file(file_obj, file_type)
            except ValueError as e:
                job.status = 'failed'
                job.error_message = str(e)
                job.completed_at = timezone.now()
                job.save()
                return Response(
                    {'error': f'Failed to extract text from file: {str(e)}'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            if not text_content or len(text_content.strip()) < 100:
                job.status = 'failed'
                job.error_message = 'Insufficient text content in file'
                job.completed_at = timezone.now()
                job.save()
                return Response(
                    {'error': 'File does not contain enough text to generate flashcards'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            
            # Generate flashcards using AI
            try:
                flashcard_data = generate_flashcards_with_retry(
                    text_content=text_content,
                    filename=filename,
                    num_cards=num_cards
                )
            except Exception as e:
                job.status = 'failed'
                job.error_message = f'AI generation failed: {str(e)}'
                job.completed_at = timezone.now()
                job.save()
                return Response(
                    {'error': f'Failed to generate flashcards: {str(e)}'},
                    status=status.HTTP_500_INTERNAL_SERVER_ERROR
                )
            
            # Create flashcard set
            set_id = str(uuid.uuid4())
            flashcard_set = FlashcardSet.objects.create(
                id=set_id,
                user=request.user,
                title=flashcard_data.get('set_title', filename),
                category=category or flashcard_data.get('set_title', 'Generated'),
                generated_from_file=True,
                source_filename=filename
            )
            
            # Create flashcards
            cards_created = 0
            for idx, card_data in enumerate(flashcard_data['cards']):
                card_id = str(uuid.uuid4())
                Flashcard.objects.create(
                    id=card_id,
                    flashcard_set=flashcard_set,
                    question=card_data['question'],
                    answer=card_data['answer'],
                    position=idx
                )
                cards_created += 1
            
            # Update job status
            job.status = 'completed'
            job.flashcard_set = flashcard_set
            job.cards_generated = cards_created
            job.completed_at = timezone.now()
            job.save()
            
            return Response({
                'job': FileGenerationJobSerializer(job).data,
                'flashcard_set': FlashcardSetSerializer(flashcard_set).data,
                'message': f'Successfully generated {cards_created} flashcards from {filename}'
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            # Catch-all error handler
            job.status = 'failed'
            job.error_message = f'Unexpected error: {str(e)}'
            job.completed_at = timezone.now()
            job.save()
            
            return Response(
                {'error': f'An unexpected error occurred: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class ListFileGenerationJobsView(generics.ListAPIView):
    """List all file generation jobs for the current user"""
    permission_classes = [IsAuthenticated]
    serializer_class = FileGenerationJobSerializer
    
    def get_queryset(self):
        return FileGenerationJob.objects.filter(user=self.request.user).order_by('-created_at')


class FileGenerationJobDetailView(generics.RetrieveAPIView):
    """Get details of a specific file generation job"""
    permission_classes = [IsAuthenticated]
    serializer_class = FileGenerationJobSerializer
    lookup_field = 'id'
    
    def get_queryset(self):
        return FileGenerationJob.objects.filter(user=self.request.user)


# ==================== INTERNET SHARING ====================

class CreateShareLinkView(APIView):
    """Create a share link for a flashcard set"""
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        serializer = CreateShareLinkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        flashcard_set_id = serializer.validated_data['flashcard_set_id']
        flashcard_set = get_object_or_404(FlashcardSet, id=flashcard_set_id, user=request.user)
        
        # Calculate expiration
        expires_at = None
        if serializer.validated_data.get('expires_in_hours'):
            expires_at = timezone.now() + timedelta(hours=serializer.validated_data['expires_in_hours'])
        
        # Create share link
        share_link = ShareLink.objects.create(
            id=ShareLink.generate_share_code(),
            user=request.user,
            flashcard_set=flashcard_set,
            share_code=ShareLink.generate_share_code(),
            share_type=serializer.validated_data.get('share_type', 'public'),
            expires_at=expires_at,
            max_uses=serializer.validated_data.get('max_uses'),
            password=serializer.validated_data.get('password'),
            allow_download=serializer.validated_data.get('allow_download', True),
            allow_copy=serializer.validated_data.get('allow_copy', True),
        )
        
        return Response(
            ShareLinkSerializer(share_link, context={'request': request}).data,
            status=status.HTTP_201_CREATED
        )


class ListShareLinksView(generics.ListAPIView):
    """List all share links created by the user"""
    permission_classes = [IsAuthenticated]
    serializer_class = ShareLinkSerializer
    
    def get_queryset(self):
        return ShareLink.objects.filter(user=self.request.user).select_related('flashcard_set')
    
    def get_serializer_context(self):
        return {'request': self.request}


class DeleteShareLinkView(APIView):
    """Delete/deactivate a share link"""
    permission_classes = [IsAuthenticated]
    
    def delete(self, request, share_code):
        share_link = get_object_or_404(ShareLink, share_code=share_code, user=request.user)
        share_link.is_active = False
        share_link.save()
        
        return Response({'message': 'Share link deactivated'}, status=status.HTTP_200_OK)


class AccessSharedSetView(APIView):
    """Access a shared flashcard set via share code"""
    permission_classes = [AllowAny]
    
    def post(self, request):
        serializer = AccessSharedSetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        share_code = serializer.validated_data['share_code']
        password = serializer.validated_data.get('password')
        action = serializer.validated_data.get('action', 'view')
        
        # Get share link
        share_link = get_object_or_404(ShareLink, share_code=share_code)
        
        # Validate share link
        if not share_link.is_valid():
            return Response(
                {'error': 'Share link is no longer valid'},
                status=status.HTTP_410_GONE
            )
        
        # Check password if required
        if share_link.password and share_link.password != password:
            return Response(
                {'error': 'Invalid password'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Check permissions
        if action == 'download' and not share_link.allow_download:
            return Response(
                {'error': 'Downloads are not allowed for this share'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        if action == 'copy' and not share_link.allow_copy:
            return Response(
                {'error': 'Copying is not allowed for this share'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Track access
        access = SharedSetAccess.objects.create(
            id=ShareLink.generate_share_code(),
            share_link=share_link,
            recipient_user=request.user if request.user.is_authenticated else None,
            ip_address=self._get_client_ip(request),
            user_agent=request.META.get('HTTP_USER_AGENT'),
        )
        
        # Update access timestamps
        if action == 'download':
            access.downloaded_at = timezone.now()
        elif action == 'copy':
            access.copied_at = timezone.now()
        access.save()
        
        # Increment use count
        share_link.increment_use_count()
        
        # Return flashcard set data
        flashcard_set = share_link.flashcard_set
        return Response({
            'flashcard_set': FlashcardSetSerializer(flashcard_set).data,
            'share_info': {
                'created_by': share_link.user.username,
                'allow_download': share_link.allow_download,
                'allow_copy': share_link.allow_copy,
            }
        })
    
    def _get_client_ip(self, request):
        """Get client IP address"""
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0]
        else:
            ip = request.META.get('REMOTE_ADDR')
        return ip


class CopySharedSetView(APIView):
    """Copy a shared set to user's library"""
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        share_code = request.data.get('share_code')
        password = request.data.get('password')
        
        share_link = get_object_or_404(ShareLink, share_code=share_code)
        
        # Validate
        if not share_link.is_valid():
            return Response(
                {'error': 'Share link is no longer valid'},
                status=status.HTTP_410_GONE
            )
        
        if share_link.password and share_link.password != password:
            return Response(
                {'error': 'Invalid password'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        if not share_link.allow_copy:
            return Response(
                {'error': 'Copying is not allowed for this share'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        # Copy the set
        original_set = share_link.flashcard_set
        new_set = FlashcardSet.objects.create(
            id=str(uuid.uuid4()),
            user=request.user,
            title=f"{original_set.title} (Copy)",
            category=original_set.category,
        )
        
        # Copy cards
        for card in original_set.cards.filter(is_deleted=False):
            Flashcard.objects.create(
                id=str(uuid.uuid4()),
                flashcard_set=new_set,
                question=card.question,
                answer=card.answer,
                position=card.position,
            )
        
        SharedSetAccess.objects.create(
            id=str(uuid.uuid4()),
            share_link=share_link,
            recipient_user=request.user,
            copied_at=timezone.now(),
        )
        
        share_link.increment_use_count()
        
        return Response(
            FlashcardSetSerializer(new_set).data,
            status=status.HTTP_201_CREATED
        )


class ListSharedSetsView(APIView):
    """List all publicly available shared flashcard sets from other users"""
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        now = timezone.now()
        
        share_links = ShareLink.objects.filter(
            is_active=True,
            share_type='public',
        ).exclude(
            user=request.user
        ).filter(
            Q(expires_at__isnull=True) | Q(expires_at__gt=now)
        ).filter(
            Q(max_uses__isnull=True) | Q(use_count__lt=F('max_uses'))
        ).select_related(
            'flashcard_set', 'user'
        ).order_by('-created_at')
        
        shared_sets = []
        for share_link in share_links:
            shared_sets.append({
                'share_code': share_link.share_code,
                'flashcard_set': {
                    'id': share_link.flashcard_set.id,
                    'title': share_link.flashcard_set.title,
                    'category': share_link.flashcard_set.category,
                    'cards_count': share_link.flashcard_set.cards.filter(is_deleted=False).count(),
                    'created_at': share_link.flashcard_set.created_at.isoformat(),
                },
                'created_by': share_link.user.username,
                'allow_download': share_link.allow_download,
                'allow_copy': share_link.allow_copy,
                'created_at': share_link.created_at.isoformat(),
                'expires_at': share_link.expires_at.isoformat() if share_link.expires_at else None,
            })
        
        return Response({
            'shared_sets': shared_sets,
            'count': len(shared_sets)
        })


class SearchSharedSetsView(APIView):
    """Search for shared flashcard sets by title or category"""
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        query = request.query_params.get('q', '').strip()
        
        if not query:
            return Response({
                'shared_sets': [],
                'message': 'Please provide a search query'
            })
        
        now = timezone.now()
        
        share_links = ShareLink.objects.filter(
            is_active=True,
            share_type='public',
        ).exclude(
            user=request.user
        ).filter(
            Q(expires_at__isnull=True) | Q(expires_at__gt=now)
        ).filter(
            Q(max_uses__isnull=True) | Q(use_count__lt=F('max_uses'))
        ).filter(
            Q(flashcard_set__title__icontains=query) |
            Q(flashcard_set__category__icontains=query)
        ).select_related(
            'flashcard_set', 'user'
        ).order_by('-created_at')[:50]
        
        shared_sets = []
        for share_link in share_links:
            shared_sets.append({
                'share_code': share_link.share_code,
                'flashcard_set': {
                    'id': share_link.flashcard_set.id,
                    'title': share_link.flashcard_set.title,
                    'category': share_link.flashcard_set.category,
                    'cards_count': share_link.flashcard_set.cards.filter(is_deleted=False).count(),
                    'created_at': share_link.flashcard_set.created_at.isoformat(),
                },
                'created_by': share_link.user.username,
                'allow_download': share_link.allow_download,
                'allow_copy': share_link.allow_copy,
                'created_at': share_link.created_at.isoformat(),
            })
        
        return Response({
            'shared_sets': shared_sets,
            'count': len(shared_sets),
            'query': query
        })


# ==================== BLUETOOTH SHARING ====================

class InitiateBluetoothShareView(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        serializer = InitiateBluetoothShareSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        flashcard_set_id = serializer.validated_data['flashcard_set_id']
        flashcard_set = get_object_or_404(FlashcardSet, id=flashcard_set_id, user=request.user)
        
        bt_share = BluetoothShare.objects.create(
            id=str(uuid.uuid4()),
            sender=request.user,
            flashcard_set=flashcard_set,
            session_code=BluetoothShare.generate_session_code(),
            device_name=serializer.validated_data.get('device_name'),
            device_id=serializer.validated_data.get('device_id'),
            expires_at=timezone.now() + timedelta(minutes=10),
        )
        
        return Response(
            BluetoothShareSerializer(bt_share).data,
            status=status.HTTP_201_CREATED
        )


class AcceptBluetoothShareView(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request):
        serializer = AcceptBluetoothShareSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        session_code = serializer.validated_data['session_code']
        bt_share = get_object_or_404(BluetoothShare, session_code=session_code)
        
        if not bt_share.is_valid():
            return Response(
                {'error': 'Bluetooth share session expired or invalid'},
                status=status.HTTP_410_GONE
            )
        
        if bt_share.sender == request.user:
            return Response(
                {'error': 'Cannot accept your own share'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        bt_share.recipient = request.user
        bt_share.status = 'paired'
        bt_share.paired_at = timezone.now()
        bt_share.device_name = serializer.validated_data.get('device_name')
        bt_share.device_id = serializer.validated_data.get('device_id')
        bt_share.save()
        
        return Response(
            BluetoothShareSerializer(bt_share).data,
            status=status.HTTP_200_OK
        )


class CompleteBluetoothShareView(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, session_code):
        bt_share = get_object_or_404(BluetoothShare, session_code=session_code)
        
        if bt_share.recipient != request.user:
            return Response(
                {'error': 'Unauthorized'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        if not bt_share.is_valid():
            return Response(
                {'error': 'Session expired'},
                status=status.HTTP_410_GONE
            )
        
        original_set = bt_share.flashcard_set
        new_set = FlashcardSet.objects.create(
            id=str(uuid.uuid4()),
            user=request.user,
            title=original_set.title,
            category=original_set.category,
        )
        
        for card in original_set.cards.filter(is_deleted=False):
            Flashcard.objects.create(
                id=str(uuid.uuid4()),
                flashcard_set=new_set,
                question=card.question,
                answer=card.answer,
                position=card.position,
            )
        
        bt_share.status = 'completed'
        bt_share.progress_percentage = 100
        bt_share.completed_at = timezone.now()
        bt_share.save()
        
        return Response({
            'flashcard_set': FlashcardSetSerializer(new_set).data,
            'bluetooth_share': BluetoothShareSerializer(bt_share).data,
        }, status=status.HTTP_201_CREATED)


class CancelBluetoothShareView(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, session_code):
        bt_share = get_object_or_404(BluetoothShare, session_code=session_code)
        
        if bt_share.sender != request.user and bt_share.recipient != request.user:
            return Response(
                {'error': 'Unauthorized'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        bt_share.status = 'cancelled'
        bt_share.save()
        
        return Response({'message': 'Share cancelled'}, status=status.HTTP_200_OK)


class BluetoothShareStatusView(generics.RetrieveAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = BluetoothShareSerializer
    lookup_field = 'session_code'
    
    def get_queryset(self):
        return BluetoothShare.objects.filter(
            Q(sender=self.request.user) | Q(recipient=self.request.user)
        )


class ListActiveBluetoothSharesView(generics.ListAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = BluetoothShareSerializer
    
    def get_queryset(self):
        return BluetoothShare.objects.filter(
            Q(sender=self.request.user) | Q(recipient=self.request.user),
            status__in=['initiated', 'paired', 'transferring'],
            expires_at__gt=timezone.now()
        )

# Add these views to your views.py file (append to the existing file)

# ==================== PROGRESS TRACKING ====================

# Complete Updated RecordStudySessionView
# Replace the entire RecordStudySessionView class in backend_flashquiz/flashcards/views.py
# backend_flashquiz/flashcards/views.py
# Update the RecordStudySessionView - replace the study_session creation section

class RecordStudySessionView(APIView):
    permission_classes = [IsAuthenticated]
    
    def post(self, request, set_id):
        user = request.user
        flashcard_set = get_object_or_404(FlashcardSet, id=set_id, user=user)
        
        study_time_seconds = request.data.get('study_time_seconds', 0)
        card_results = request.data.get('card_results', [])
        session_type = request.data.get('session_type', None)
        
        if not isinstance(study_time_seconds, int) or study_time_seconds < 0:
            return Response({'error': 'Invalid study_time_seconds'}, status=status.HTTP_400_BAD_REQUEST)
        
        if not isinstance(card_results, list):
            return Response({'error': 'card_results must be a list'}, status=status.HTTP_400_BAD_REQUEST)
        
        # Auto-detect session type if not provided
        if session_type not in ['quiz', 'study']:
            total_cards = flashcard_set.cards.filter(is_deleted=False).count()
            cards_answered = len(card_results)
            
            if cards_answered >= total_cards * 0.5:
                avg_time_per_card = study_time_seconds / cards_answered if cards_answered > 0 else 0
                session_type = 'quiz' if avg_time_per_card < 30 else 'study'
            else:
                session_type = 'study'
        
        # Calculate scores
        session_id = str(uuid.uuid4())
        correct_count = sum(1 for r in card_results if r.get('correct'))
        incorrect_count = len(card_results) - correct_count
        
        # ✅ Calculate quiz-specific metrics
        quiz_score = correct_count  # Number of correct answers
        quiz_accuracy = (correct_count / len(card_results) * 100) if len(card_results) > 0 else 0.0
        
        # ✅ Create study session with quiz metrics
        study_session = StudySession.objects.create(
            id=session_id,
            user=user,
            flashcard_set=flashcard_set,
            started_at=timezone.now() - timedelta(seconds=study_time_seconds),
            completed_at=timezone.now(),
            total_cards=len(card_results),
            correct_count=correct_count,
            incorrect_count=incorrect_count,
            session_type=session_type,
            quiz_score=quiz_score,        # ✅ ADD THIS
            quiz_accuracy=quiz_accuracy   # ✅ ADD THIS
        )
        
        # ... rest of the code stays the same (card progress updates, etc.) ...
        
        MAX_INTERVAL_DAYS = 365
        
        with transaction.atomic():
            # ... all the card progress update logic stays the same ...
            
            # [Keep all existing card progress code here]
            
            for result in card_results:
                card_id = result.get('card_id')
                is_correct = result.get('correct', False)
                
                card = Flashcard.objects.filter(
                    id=card_id,
                    flashcard_set=flashcard_set,
                    is_deleted=False
                ).first()
                
                if not card:
                    continue
                
                card_progress, created = CardProgress.objects.get_or_create(
                    user=user,
                    flashcard=card,
                    defaults={
                        'id': str(uuid.uuid4()),
                        'study_session': study_session,
                        'times_seen': 0,
                        'times_correct': 0,
                        'times_incorrect': 0,
                        'ease_factor': 2.5,
                        'interval_days': 0,
                        'repetitions': 0,
                    }
                )
                
                card_progress.times_seen += 1
                if is_correct:
                    card_progress.times_correct += 1
                    card_progress.last_response = 'good'
                    card_progress.repetitions += 1
                else:
                    card_progress.times_incorrect += 1
                    card_progress.last_response = 'again'
                    card_progress.repetitions = 0
                
                card_progress.last_reviewed = timezone.now()
                card_progress.study_session = study_session
                
                if session_type == 'quiz':
                    card_progress.next_review = timezone.now()
                    if is_correct:
                        card_progress.ease_factor = min(2.5, card_progress.ease_factor + 0.05)
                    else:
                        card_progress.ease_factor = max(1.3, card_progress.ease_factor - 0.05)
                    card_progress.interval_days = 0
                else:
                    if is_correct:
                        card_progress.ease_factor = min(2.5, card_progress.ease_factor + 0.1)
                        if card_progress.repetitions == 1:
                            card_progress.interval_days = 1
                        elif card_progress.repetitions == 2:
                            card_progress.interval_days = 6
                        else:
                            new_interval = int(card_progress.interval_days * card_progress.ease_factor)
                            card_progress.interval_days = min(new_interval, MAX_INTERVAL_DAYS)
                    else:
                        card_progress.ease_factor = max(1.3, card_progress.ease_factor - 0.2)
                        card_progress.interval_days = 0
                    
                    try:
                        safe_interval = min(max(card_progress.interval_days, 0), MAX_INTERVAL_DAYS)
                        card_progress.next_review = timezone.now() + timedelta(days=safe_interval)
                    except (OverflowError, ValueError):
                        card_progress.next_review = timezone.now() + timedelta(days=MAX_INTERVAL_DAYS)
                
                card_progress.save()
            
            # Update flashcard set progress
            flashcard_set.last_studied_at = timezone.now()
            flashcard_set.total_study_time_seconds = (flashcard_set.total_study_time_seconds or 0) + study_time_seconds
            flashcard_set.update_progress()
            
            # Update set progress
            set_progress, created = SetProgress.objects.get_or_create(
                user=user,
                flashcard_set=flashcard_set,
                defaults={
                    'id': str(uuid.uuid4()),
                    'total_cards_studied': 0,
                    'mastered_cards': 0,
                    'learning_cards': 0,
                    'new_cards': flashcard_set.total_cards,
                    'total_study_time_seconds': 0,
                    'overall_accuracy': 0.0,
                }
            )
            
            set_progress.total_cards_studied = len(set(
                CardProgress.objects.filter(
                    user=user,
                    flashcard__flashcard_set=flashcard_set,
                    flashcard__is_deleted=False,
                    is_deleted=False
                ).values_list('flashcard_id', flat=True)
            ))
            set_progress.mastered_cards = flashcard_set.mastered_cards
            set_progress.learning_cards = flashcard_set.learning_cards
            set_progress.new_cards = flashcard_set.new_cards
            set_progress.total_study_time_seconds = flashcard_set.total_study_time_seconds
            set_progress.last_studied = timezone.now()
            set_progress.overall_accuracy = flashcard_set.overall_accuracy
            
            if set_progress.last_studied:
                days_since_last_study = (timezone.now().date() - set_progress.last_studied.date()).days
                if days_since_last_study == 1:
                    set_progress.study_streak_days += 1
                elif days_since_last_study > 1:
                    set_progress.study_streak_days = 1
            else:
                set_progress.study_streak_days = 1
            
            flashcard_set.study_streak_days = set_progress.study_streak_days
            
            set_progress.save()
            flashcard_set.save()
        
        # ✅ Updated response to include quiz score
        return Response({
            'message': f'{session_type.capitalize()} session recorded successfully',
            'session_type': session_type,
            'study_session': StudySessionSerializer(study_session).data,
            'flashcard_set': FlashcardSetSerializer(flashcard_set).data,
            'progress': {
                'total_cards': flashcard_set.total_cards,
                'mastered_cards': flashcard_set.mastered_cards,
                'learning_cards': flashcard_set.learning_cards,
                'new_cards': flashcard_set.new_cards,
                'overall_accuracy': flashcard_set.overall_accuracy,
                'progress_percentage': flashcard_set.progress_percentage,
                'study_streak_days': flashcard_set.study_streak_days,
                'total_study_time_seconds': flashcard_set.total_study_time_seconds,
            },
            'quiz_session': {  # ✅ ADD THIS - current quiz session data
                'score': quiz_score,
                'accuracy': quiz_accuracy,
                'total_cards': len(card_results),
            }
        }, status=status.HTTP_201_CREATED)

class UpdateSetProgressView(APIView):
    """
    Manually trigger progress calculation for a flashcard set
    
    This endpoint recalculates all progress metrics based on existing
    study data and card progress records.
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request, set_id):
        user = request.user
        
        # Get the flashcard set
        flashcard_set = get_object_or_404(FlashcardSet, id=set_id, user=user)
        
        # Update progress
        with transaction.atomic():
            flashcard_set.update_progress()
            
            # Also update SetProgress if it exists
            set_progress = SetProgress.objects.filter(
                user=user,
                flashcard_set=flashcard_set
            ).first()
            
            if set_progress:
                set_progress.total_cards_studied = len(set(
                    CardProgress.objects.filter(
                        user=user,
                        flashcard__flashcard_set=flashcard_set,
                        flashcard__is_deleted=False,
                        is_deleted=False
                    ).values_list('flashcard_id', flat=True)
                ))
                set_progress.mastered_cards = flashcard_set.mastered_cards
                set_progress.learning_cards = flashcard_set.learning_cards
                set_progress.new_cards = flashcard_set.new_cards
                set_progress.total_study_time_seconds = flashcard_set.total_study_time_seconds
                set_progress.overall_accuracy = flashcard_set.overall_accuracy
                set_progress.save()
        
        return Response({
            'message': 'Progress updated successfully',
            'flashcard_set': FlashcardSetSerializer(flashcard_set).data,
            'progress': {
                'total_cards': flashcard_set.total_cards,
                'mastered_cards': flashcard_set.mastered_cards,
                'learning_cards': flashcard_set.learning_cards,
                'new_cards': flashcard_set.new_cards,
                'overall_accuracy': flashcard_set.overall_accuracy,
                'progress_percentage': flashcard_set.progress_percentage,
                'last_studied_at': flashcard_set.last_studied_at.isoformat() if flashcard_set.last_studied_at else None,
                'study_streak_days': flashcard_set.study_streak_days,
                'total_study_time_seconds': flashcard_set.total_study_time_seconds,
            }
        }, status=status.HTTP_200_OK)


class GetSetProgressView(APIView):
    """
    Get progress statistics for a specific flashcard set
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request, set_id):
        user = request.user
        
        # Get the flashcard set
        flashcard_set = get_object_or_404(FlashcardSet, id=set_id, user=user)
        
        # Get card progress data
        card_progress_data = CardProgress.objects.filter(
            user=user,
            flashcard__flashcard_set=flashcard_set,
            flashcard__is_deleted=False,
            is_deleted=False
        ).select_related('flashcard')
        
        # Get set progress
        set_progress = SetProgress.objects.filter(
            user=user,
            flashcard_set=flashcard_set
        ).first()
        
        return Response({
            'flashcard_set_id': flashcard_set.id,
            'flashcard_set_title': flashcard_set.title,
            'progress': {
                'total_cards': flashcard_set.total_cards,
                'mastered_cards': flashcard_set.mastered_cards,
                'learning_cards': flashcard_set.learning_cards,
                'new_cards': flashcard_set.new_cards,
                'overall_accuracy': flashcard_set.overall_accuracy,
                'progress_percentage': flashcard_set.progress_percentage,
                'last_studied_at': flashcard_set.last_studied_at.isoformat() if flashcard_set.last_studied_at else None,
                'study_streak_days': flashcard_set.study_streak_days,
                'total_study_time_seconds': flashcard_set.total_study_time_seconds,
            },
            'set_progress': SetProgressSerializer(set_progress).data if set_progress else None,
            'card_count': {
                'total': flashcard_set.cards.filter(is_deleted=False).count(),
                'studied': card_progress_data.count(),
            }
        }, status=status.HTTP_200_OK)


class ListUserProgressView(APIView):
    """
    Get progress summary for all flashcard sets owned by the user
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        user = request.user
        
        # Get all user's sets with progress
        flashcard_sets = FlashcardSet.objects.filter(
            user=user,
            is_deleted=False
        ).order_by('-last_studied_at')
        
        progress_data = []
        for fs in flashcard_sets:
            progress_data.append({
                'flashcard_set': {
                    'id': fs.id,
                    'title': fs.title,
                    'category': fs.category,
                    'cards_count': fs.cards.filter(is_deleted=False).count(),
                },
                'progress': {
                    'total_cards': fs.total_cards,
                    'mastered_cards': fs.mastered_cards,
                    'learning_cards': fs.learning_cards,
                    'new_cards': fs.new_cards,
                    'overall_accuracy': fs.overall_accuracy,
                    'progress_percentage': fs.progress_percentage,
                    'last_studied_at': fs.last_studied_at.isoformat() if fs.last_studied_at else None,
                    'study_streak_days': fs.study_streak_days,
                    'total_study_time_seconds': fs.total_study_time_seconds,
                }
            })
        
        # Calculate overall statistics
        total_sets = len(progress_data)
        total_cards_across_sets = sum(p['progress']['total_cards'] for p in progress_data)
        total_mastered_across_sets = sum(p['progress']['mastered_cards'] for p in progress_data)
        total_study_time = sum(p['progress']['total_study_time_seconds'] for p in progress_data)
        
        return Response({
            'sets': progress_data,
            'summary': {
                'total_sets': total_sets,
                'total_cards': total_cards_across_sets,
                'total_mastered': total_mastered_across_sets,
                'total_study_time_seconds': total_study_time,
                'total_study_time_hours': round(total_study_time / 3600, 1),
            }
        }, status=status.HTTP_200_OK)


class GetLatestQuizSessionView(APIView):
    """
    Get the most recent quiz session for a flashcard set
    This allows frontend to display the last quiz score even after page reload
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request, set_id):
        user = request.user
        
        # Get the flashcard set
        flashcard_set = get_object_or_404(FlashcardSet, id=set_id, user=user)
        
        # Get the most recent quiz session
        latest_quiz = StudySession.objects.filter(
            user=user,
            flashcard_set=flashcard_set,
            session_type='quiz',
            is_deleted=False
        ).order_by('-completed_at').first()
        
        if not latest_quiz:
            return Response({
                'has_quiz_session': False,
                'message': 'No quiz sessions found'
            }, status=status.HTTP_200_OK)
        
        return Response({
            'has_quiz_session': True,
            'quiz_session': {
                'id': latest_quiz.id,
                'score': latest_quiz.quiz_score,
                'accuracy': latest_quiz.quiz_accuracy,
                'total_cards': latest_quiz.total_cards,
                'correct_count': latest_quiz.correct_count,
                'completed_at': latest_quiz.completed_at.isoformat() if latest_quiz.completed_at else None,
                'study_time_seconds': int((latest_quiz.completed_at - latest_quiz.started_at).total_seconds()) if latest_quiz.completed_at else 0
            }
        }, status=status.HTTP_200_OK)

