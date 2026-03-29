from rest_framework import serializers
from .models import (
    User, Category, FlashcardSet, Flashcard,
    StudySession, CardProgress, SetProgress,
    ShareLink, SharedSetAccess, BluetoothShare,
    FileGenerationJob
)
from django.contrib.auth import authenticate

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'email', 'username']

class SignupSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['email', 'username', 'password']
        extra_kwargs = {'password': {'write_only': True}}

    def create(self, validated_data):
        return User.objects.create_user(
            email=validated_data['email'],
            username=validated_data['username'],
            password=validated_data['password']
        )

class LoginSerializer(serializers.Serializer):
    email_or_username = serializers.CharField()
    password = serializers.CharField(write_only=True)

    def validate(self, data):
        email_or_username = data.get('email_or_username')
        password = data.get('password')

        user = User.objects.filter(email=email_or_username).first() or \
               User.objects.filter(username=email_or_username).first()

        if user and user.check_password(password):
            data['user'] = user
            return data
        raise serializers.ValidationError("Invalid credentials")


# ==================== Sync Serializers ====================

class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ['id', 'name', 'created_at', 'updated_at']
        read_only_fields = ['created_at', 'updated_at']


class FlashcardSerializer(serializers.ModelSerializer):
    class Meta:
        model = Flashcard
        fields = ['id', 'question', 'answer', 'position', 'created_at', 'updated_at', 'is_deleted']
        read_only_fields = ['created_at', 'updated_at']


class FlashcardSetSerializer(serializers.ModelSerializer):
    cards = FlashcardSerializer(many=True, required=False)
    
    class Meta:
        model = FlashcardSet
        fields = [
            'id', 'title', 'category', 'cards', 'created_at', 'updated_at', 
            'is_deleted', 'generated_from_file', 'source_filename',
            # Progress fields
            'total_cards', 'mastered_cards', 'learning_cards', 'new_cards',
            'last_studied_at', 'study_streak_days', 'total_study_time_seconds',
            'overall_accuracy', 'progress_percentage'
        ]
        read_only_fields = [
            'created_at', 'updated_at',
            # Progress fields are calculated, not directly set
            'total_cards', 'mastered_cards', 'learning_cards', 'new_cards',
            'overall_accuracy', 'progress_percentage'
        ]


# ==================== Progress Serializers ====================

class CardProgressSerializer(serializers.ModelSerializer):
    flashcard_id = serializers.CharField(source='flashcard.id', read_only=True)
    
    class Meta:
        model = CardProgress
        fields = [
            'id', 'flashcard_id', 'study_session', 
            'times_seen', 'times_correct', 'times_incorrect',
            'last_reviewed', 'ease_factor', 'interval_days', 
            'next_review', 'last_response',
            'created_at', 'updated_at', 'is_deleted'
        ]
        read_only_fields = ['created_at', 'updated_at']



class StudySessionSerializer(serializers.ModelSerializer):
    card_progress = CardProgressSerializer(many=True, required=False, read_only=True)
    flashcard_set_id = serializers.CharField(source='flashcard_set.id', read_only=True)
    
    class Meta:
        model = StudySession
        fields = [
            'id', 'flashcard_set_id', 'started_at', 'completed_at',
            'total_cards', 'correct_count', 'incorrect_count',
            'session_type',       # ✅ Existing field
            'quiz_score',         # ✅ ADD THIS
            'quiz_accuracy',      # ✅ ADD THIS
            'card_progress', 'created_at', 'updated_at', 'is_deleted'
        ]
        read_only_fields = ['created_at', 'updated_at']



class SetProgressSerializer(serializers.ModelSerializer):
    flashcard_set_id = serializers.CharField(source='flashcard_set.id', read_only=True)
    
    class Meta:
        model = SetProgress
        fields = [
            'id', 'flashcard_set_id',
            'total_cards_studied', 'mastered_cards', 'learning_cards', 'new_cards',
            'total_study_time_seconds', 'last_studied', 'study_streak_days',
            'overall_accuracy',
            'created_at', 'updated_at', 'is_deleted'
        ]
        read_only_fields = ['created_at', 'updated_at']


# ==================== Sync Request/Response Serializers ====================

class SyncRequestSerializer(serializers.Serializer):
    """Incoming sync request from client"""
    last_sync = serializers.DateTimeField(required=False, allow_null=True)
    categories = CategorySerializer(many=True, required=False)
    flashcard_sets = FlashcardSetSerializer(many=True, required=False)
    study_sessions = StudySessionSerializer(many=True, required=False)
    card_progress = CardProgressSerializer(many=True, required=False)
    set_progress = SetProgressSerializer(many=True, required=False)


class SyncResponseSerializer(serializers.Serializer):
    """Outgoing sync response to client"""
    categories = CategorySerializer(many=True)
    flashcard_sets = FlashcardSetSerializer(many=True)
    study_sessions = StudySessionSerializer(many=True)
    card_progress = CardProgressSerializer(many=True)
    set_progress = SetProgressSerializer(many=True)
    sync_timestamp = serializers.DateTimeField()


# ==================== Sharing Serializers ====================

class ShareLinkSerializer(serializers.ModelSerializer):
    share_url = serializers.SerializerMethodField()
    is_valid = serializers.SerializerMethodField()
    
    class Meta:
        model = ShareLink
        fields = [
            'id', 'flashcard_set', 'share_code', 'share_type', 
            'is_active', 'expires_at', 'max_uses', 'use_count',
            'allow_download', 'allow_copy', 'password',
            'created_at', 'last_accessed_at', 'share_url', 'is_valid'
        ]
        read_only_fields = ['id', 'share_code', 'use_count', 'created_at', 'last_accessed_at']
        extra_kwargs = {
            'password': {'write_only': True, 'required': False}
        }
    
    def get_share_url(self, obj):
        frontend_url = "http://192.168.8.34:5173"
        return f"{frontend_url}/share/{obj.share_code}"
    
    def get_is_valid(self, obj):
        return obj.is_valid()


class CreateShareLinkSerializer(serializers.Serializer):
    flashcard_set_id = serializers.CharField()
    share_type = serializers.ChoiceField(choices=['public', 'private'], default='public')
    expires_in_hours = serializers.IntegerField(required=False, allow_null=True, min_value=1, max_value=720)
    max_uses = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    password = serializers.CharField(required=False, allow_null=True, max_length=128)
    allow_download = serializers.BooleanField(default=True)
    allow_copy = serializers.BooleanField(default=True)


class SharedSetAccessSerializer(serializers.ModelSerializer):
    class Meta:
        model = SharedSetAccess
        fields = [
            'id', 'share_link', 'recipient_user', 'ip_address',
            'viewed_at', 'downloaded_at', 'copied_at'
        ]
        read_only_fields = ['id', 'viewed_at']


class BluetoothShareSerializer(serializers.ModelSerializer):
    sender_username = serializers.CharField(source='sender.username', read_only=True)
    recipient_username = serializers.CharField(source='recipient.username', read_only=True, allow_null=True)
    flashcard_set_title = serializers.CharField(source='flashcard_set.title', read_only=True)
    is_valid = serializers.SerializerMethodField()
    
    class Meta:
        model = BluetoothShare
        fields = [
            'id', 'sender', 'sender_username', 'recipient', 'recipient_username',
            'flashcard_set', 'flashcard_set_title', 'session_code', 
            'device_name', 'device_id', 'status', 'progress_percentage',
            'initiated_at', 'paired_at', 'completed_at', 'expires_at', 'is_valid'
        ]
        read_only_fields = [
            'id', 'session_code', 'initiated_at', 'paired_at', 
            'completed_at', 'expires_at'
        ]
    
    def get_is_valid(self, obj):
        return obj.is_valid()


class InitiateBluetoothShareSerializer(serializers.Serializer):
    flashcard_set_id = serializers.CharField()
    device_name = serializers.CharField(required=False, allow_null=True, max_length=255)
    device_id = serializers.CharField(required=False, allow_null=True, max_length=255)


class AcceptBluetoothShareSerializer(serializers.Serializer):
    session_code = serializers.CharField(max_length=16)
    device_name = serializers.CharField(required=False, allow_null=True, max_length=255)
    device_id = serializers.CharField(required=False, allow_null=True, max_length=255)


class AccessSharedSetSerializer(serializers.Serializer):
    share_code = serializers.CharField(max_length=32)
    password = serializers.CharField(required=False, allow_null=True)
    action = serializers.ChoiceField(choices=['view', 'download', 'copy'], default='view')


# ==================== File Generation Serializers ====================

class FileGenerationJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = FileGenerationJob
        fields = [
            'id', 'filename', 'file_type', 'file_size', 'status',
            'error_message', 'flashcard_set', 'cards_generated',
            'created_at', 'completed_at'
        ]
        read_only_fields = [
            'id', 'status', 'error_message', 'flashcard_set',
            'cards_generated', 'created_at', 'completed_at'
        ]


class GenerateFlashcardsFromFileSerializer(serializers.Serializer):
    """Serializer for file upload and flashcard generation request"""
    file = serializers.FileField(
        help_text="PDF, DOCX, or PPTX file to generate flashcards from"
    )
    num_cards = serializers.IntegerField(
        default=20,
        min_value=5,
        max_value=50,
        help_text="Number of flashcards to generate (5-50)"
    )
    category = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
        max_length=255,
        help_text="Optional category for the generated flashcard set"
    )

class RecordStudySessionRequestSerializer(serializers.Serializer):
    """Request payload for recording a study session"""
    study_time_seconds = serializers.IntegerField(min_value=0)
    card_results = serializers.ListField(
        child=serializers.DictField(
            child=serializers.JSONField()
        ),
        min_length=1
    )
    
    def validate_card_results(self, value):
        """Validate that each card result has required fields"""
        for result in value:
            if 'card_id' not in result:
                raise serializers.ValidationError("Each card result must have a 'card_id'")
            if 'correct' not in result:
                raise serializers.ValidationError("Each card result must have a 'correct' boolean")
            if not isinstance(result['correct'], bool):
                raise serializers.ValidationError("'correct' must be a boolean value")
        return value


# New serializer for progress response
class ProgressStatsSerializer(serializers.Serializer):
    """Progress statistics for a flashcard set"""
    total_cards = serializers.IntegerField()
    mastered_cards = serializers.IntegerField()
    learning_cards = serializers.IntegerField()
    new_cards = serializers.IntegerField()
    overall_accuracy = serializers.FloatField()
    progress_percentage = serializers.FloatField()
    last_studied_at = serializers.DateTimeField(allow_null=True)
    study_streak_days = serializers.IntegerField()
    total_study_time_seconds = serializers.IntegerField()


class RecordStudySessionResponseSerializer(serializers.Serializer):
    """Response after recording a study session"""
    message = serializers.CharField()
    study_session = StudySessionSerializer()
    flashcard_set = FlashcardSetSerializer()
    progress = ProgressStatsSerializer()
