from django.db import models
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.utils import timezone
import secrets

class UserManager(BaseUserManager):
    def create_user(self, email, username, password=None):
        if not email:
            raise ValueError("Email is required")
        if not username:
            raise ValueError("Username is required")
        email = self.normalize_email(email)
        user = self.model(email=email, username=username)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, username, password):
        user = self.create_user(email, username, password)
        user.is_staff = True
        user.is_superuser = True
        user.save(using=self._db)
        return user

class User(AbstractBaseUser, PermissionsMixin):
    email = models.EmailField(unique=True)
    username = models.CharField(max_length=30, unique=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)

    objects = UserManager()

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username']

    def __str__(self):
        return self.email


class Category(models.Model):
    """Categories for organizing flashcard sets"""
    id = models.CharField(max_length=255, primary_key=True)  # UUID from frontend
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='categories')
    name = models.CharField(max_length=255)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'flashcard_categories'
        unique_together = [['user', 'name']]
        ordering = ['name']
        indexes = [
            models.Index(fields=['user', 'updated_at']),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.name}"


class FlashcardSet(models.Model):
    """Flashcard sets belonging to users"""
    id = models.CharField(max_length=255, primary_key=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='flashcard_sets')
    title = models.CharField(max_length=255)
    category = models.CharField(max_length=255, blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    is_deleted = models.BooleanField(default=False)
    
    # File generation tracking
    generated_from_file = models.BooleanField(default=False)
    source_filename = models.CharField(max_length=255, blank=True, null=True)
    
    # NEW: Progress tracking fields
    total_cards = models.IntegerField(default=0)
    mastered_cards = models.IntegerField(default=0)  # Cards with high accuracy
    learning_cards = models.IntegerField(default=0)  # Cards being practiced
    new_cards = models.IntegerField(default=0)  # Never studied
    last_studied_at = models.DateTimeField(null=True, blank=True)
    study_streak_days = models.IntegerField(default=0)
    total_study_time_seconds = models.IntegerField(default=0)
    overall_accuracy = models.FloatField(default=0.0)  # 0-100 percentage
    progress_percentage = models.FloatField(default=0.0)  # Overall completion 0-100
    
    class Meta:
        db_table = 'flashcard_sets'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'updated_at']),
            models.Index(fields=['user', 'is_deleted']),
            models.Index(fields=['user', 'last_studied_at']),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.title}"
    
    def update_progress(self):
        """Calculate and update progress metrics based on cards and study data"""
        cards = self.cards.filter(is_deleted=False)
        self.total_cards = cards.count()
        
        if self.total_cards == 0:
            self.new_cards = 0
            self.learning_cards = 0
            self.mastered_cards = 0
            self.progress_percentage = 0.0
            self.overall_accuracy = 0.0
            self.save()
            return
        
        # Get card progress data
        from .models import CardProgress
        card_progress_data = CardProgress.objects.filter(
            user=self.user,
            flashcard__flashcard_set=self,
            flashcard__is_deleted=False,
            is_deleted=False
        )
        
        studied_cards = set(cp.flashcard_id for cp in card_progress_data)
        self.new_cards = self.total_cards - len(studied_cards)
        
        # Calculate mastered and learning
        mastered = 0
        learning = 0
        total_correct = 0
        total_attempts = 0
        
        for cp in card_progress_data:
            accuracy = (cp.times_correct / cp.times_seen * 100) if cp.times_seen > 0 else 0
            
            if accuracy >= 80 and cp.times_seen >= 3:
                mastered += 1
            elif cp.times_seen > 0:
                learning += 1
            
            total_correct += cp.times_correct
            total_attempts += cp.times_seen
        
        self.mastered_cards = mastered
        self.learning_cards = learning
        
        # Calculate overall accuracy
        self.overall_accuracy = (total_correct / total_attempts * 100) if total_attempts > 0 else 0.0
        
        # Calculate progress percentage (based on mastery)
        self.progress_percentage = (mastered / self.total_cards * 100) if self.total_cards > 0 else 0.0
        
        self.save()

    """Flashcard sets belonging to users"""
    id = models.CharField(max_length=255, primary_key=True)  # UUID from frontend
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='flashcard_sets')
    title = models.CharField(max_length=255)
    category = models.CharField(max_length=255, blank=True, null=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    is_deleted = models.BooleanField(default=False)
    
    # NEW: Track if generated from file
    generated_from_file = models.BooleanField(default=False)
    source_filename = models.CharField(max_length=255, blank=True, null=True)
    
    class Meta:
        db_table = 'flashcard_sets'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'updated_at']),
            models.Index(fields=['user', 'is_deleted']),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.title}"


class Flashcard(models.Model):
    """Individual flashcards within sets"""
    id = models.CharField(max_length=255, primary_key=True)  # UUID from frontend
    flashcard_set = models.ForeignKey(FlashcardSet, on_delete=models.CASCADE, related_name='cards')
    question = models.TextField()
    answer = models.TextField()
    position = models.IntegerField(default=0)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    is_deleted = models.BooleanField(default=False)
    
    class Meta:
        db_table = 'flashcards'
        ordering = ['position', 'created_at']
        indexes = [
            models.Index(fields=['flashcard_set', 'updated_at']),
            models.Index(fields=['flashcard_set', 'is_deleted']),
        ]

    def __str__(self):
        return f"{self.flashcard_set.title} - {self.question[:50]}"


class StudySession(models.Model):
    """Study sessions for tracking when users study sets"""
    id = models.CharField(max_length=255, primary_key=True)  # UUID from frontend
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='study_sessions')
    flashcard_set = models.ForeignKey(FlashcardSet, on_delete=models.CASCADE, related_name='study_sessions')
    started_at = models.DateTimeField(default=timezone.now)
    completed_at = models.DateTimeField(null=True, blank=True)
    total_cards = models.IntegerField(default=0)
    correct_count = models.IntegerField(default=0)
    incorrect_count = models.IntegerField(default=0)
    session_type = models.CharField(              
        max_length=10,                            
        choices=[('quiz', 'Quiz'), ('study', 'Study')],  
        default='study',                           
        blank=True                                 
    ) 
    quiz_score = models.IntegerField(default=0, help_text="Number of correct answers in quiz session")
    quiz_accuracy = models.FloatField(default=0.0, help_text="Percentage accuracy for quiz session (0-100)")
    
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    is_deleted = models.BooleanField(default=False)
    
    class Meta:
        db_table = 'study_sessions'
        ordering = ['-started_at']
        indexes = [
            models.Index(fields=['user', 'updated_at']),
            models.Index(fields=['user', 'flashcard_set', 'started_at']),
            models.Index(fields=['user', 'is_deleted']),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.flashcard_set.title} - {self.started_at}"


class CardProgress(models.Model):
    """Track individual card performance within study sessions"""
    id = models.CharField(max_length=255, primary_key=True)  # UUID from frontend
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='card_progress')
    flashcard = models.ForeignKey(Flashcard, on_delete=models.CASCADE, related_name='progress_records')
    study_session = models.ForeignKey(StudySession, on_delete=models.CASCADE, related_name='card_progress', null=True, blank=True)
    
    # Performance tracking
    times_seen = models.IntegerField(default=0)
    times_correct = models.IntegerField(default=0)
    times_incorrect = models.IntegerField(default=0)
    last_reviewed = models.DateTimeField(null=True, blank=True)
    
    # Spaced repetition data
    ease_factor = models.FloatField(default=2.5)  # Used in SM2 algorithm
    interval_days = models.IntegerField(default=0)  # Days until next review
    next_review = models.DateTimeField(null=True, blank=True)
    repetitions = models.IntegerField(default=0)
    
    # Response tracking
    last_response = models.CharField(
        max_length=20, 
        choices=[
            ('again', 'Again'),
            ('hard', 'Hard'),
            ('good', 'Good'),
            ('easy', 'Easy'),
        ],
        null=True,
        blank=True
    )
    
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    is_deleted = models.BooleanField(default=False)
    
    class Meta:
        db_table = 'card_progress'
        unique_together = [['user', 'flashcard']]
        ordering = ['-last_reviewed']
        indexes = [
            models.Index(fields=['user', 'updated_at']),
            models.Index(fields=['user', 'flashcard', 'updated_at']),
            models.Index(fields=['user', 'next_review']),
            models.Index(fields=['user', 'is_deleted']),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.flashcard.question[:30]} - {self.times_correct}/{self.times_seen}"


class SetProgress(models.Model):
    """Aggregate progress tracking per flashcard set"""
    id = models.CharField(max_length=255, primary_key=True)  # UUID from frontend
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='set_progress')
    flashcard_set = models.ForeignKey(FlashcardSet, on_delete=models.CASCADE, related_name='progress_records')
    
    # Aggregate statistics
    total_cards_studied = models.IntegerField(default=0)
    mastered_cards = models.IntegerField(default=0)  # Cards with >80% accuracy
    learning_cards = models.IntegerField(default=0)  # Cards with 50-80% accuracy
    new_cards = models.IntegerField(default=0)  # Cards never studied
    
    # Time tracking
    total_study_time_seconds = models.IntegerField(default=0)
    last_studied = models.DateTimeField(null=True, blank=True)
    study_streak_days = models.IntegerField(default=0)
    
    # Overall performance
    overall_accuracy = models.FloatField(default=0.0)  # Percentage 0-100
    
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    is_deleted = models.BooleanField(default=False)
    
    class Meta:
        db_table = 'set_progress'
        unique_together = [['user', 'flashcard_set']]
        ordering = ['-last_studied']
        indexes = [
            models.Index(fields=['user', 'updated_at']),
            models.Index(fields=['user', 'flashcard_set', 'updated_at']),
            models.Index(fields=['user', 'last_studied']),
            models.Index(fields=['user', 'is_deleted']),
        ]

    def __str__(self):
        return f"{self.user.username} - {self.flashcard_set.title} - {self.overall_accuracy:.1f}%"


class ShareLink(models.Model):
    """Share links for flashcard sets"""
    SHARE_TYPE_CHOICES = [
        ('public', 'Public Link'),
        ('private', 'Private Link'),
    ]
    
    id = models.CharField(max_length=255, primary_key=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='share_links')
    flashcard_set = models.ForeignKey(FlashcardSet, on_delete=models.CASCADE, related_name='share_links')
    
    # Share link details
    share_code = models.CharField(max_length=32, unique=True, db_index=True)
    share_type = models.CharField(max_length=20, choices=SHARE_TYPE_CHOICES, default='public')
    
    # Access control
    is_active = models.BooleanField(default=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    max_uses = models.IntegerField(null=True, blank=True)  # Null = unlimited
    use_count = models.IntegerField(default=0)
    
    # Password protection (optional)
    password = models.CharField(max_length=128, null=True, blank=True)
    
    # Permissions
    allow_download = models.BooleanField(default=True)
    allow_copy = models.BooleanField(default=True)
    
    # Metadata
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    last_accessed_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        db_table = 'share_links'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['share_code', 'is_active']),
            models.Index(fields=['user', 'created_at']),
        ]
    
    def __str__(self):
        return f"{self.flashcard_set.title} - {self.share_code}"
    
    def is_valid(self):
        """Check if share link is still valid"""
        if not self.is_active:
            return False
        
        if self.expires_at and timezone.now() > self.expires_at:
            return False
        
        if self.max_uses and self.use_count >= self.max_uses:
            return False
        
        return True
    
    def increment_use_count(self):
        """Increment use count and update last accessed time"""
        self.use_count += 1
        self.last_accessed_at = timezone.now()
        self.save(update_fields=['use_count', 'last_accessed_at'])
    
    @staticmethod
    def generate_share_code():
        """Generate a unique share code"""
        return secrets.token_urlsafe(16)


class SharedSetAccess(models.Model):
    """Track who accessed shared sets"""
    id = models.CharField(max_length=255, primary_key=True)
    share_link = models.ForeignKey(ShareLink, on_delete=models.CASCADE, related_name='accesses')
    
    # Recipient info (if they save the set)
    recipient_user = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='received_sets')
    
    # Anonymous access tracking
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.TextField(null=True, blank=True)
    
    # Actions taken
    viewed_at = models.DateTimeField(default=timezone.now)
    downloaded_at = models.DateTimeField(null=True, blank=True)
    copied_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        db_table = 'shared_set_accesses'
        ordering = ['-viewed_at']
        indexes = [
            models.Index(fields=['share_link', 'viewed_at']),
            models.Index(fields=['recipient_user', 'viewed_at']),
        ]
    
    def __str__(self):
        return f"{self.share_link.share_code} - {self.viewed_at}"


class BluetoothShare(models.Model):
    """Track Bluetooth share sessions"""
    STATUS_CHOICES = [
        ('initiated', 'Initiated'),
        ('paired', 'Paired'),
        ('transferring', 'Transferring'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
        ('cancelled', 'Cancelled'),
    ]
    
    id = models.CharField(max_length=255, primary_key=True)
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='bluetooth_sends')
    flashcard_set = models.ForeignKey(FlashcardSet, on_delete=models.CASCADE, related_name='bluetooth_shares')
    
    # Bluetooth session details
    session_code = models.CharField(max_length=16, unique=True, db_index=True)  # Short pairing code
    device_name = models.CharField(max_length=255, null=True, blank=True)
    device_id = models.CharField(max_length=255, null=True, blank=True)
    
    # Transfer status
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='initiated')
    progress_percentage = models.IntegerField(default=0)
    
    # Recipient (if they're logged in)
    recipient = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='bluetooth_receives')
    
    # Timestamps
    initiated_at = models.DateTimeField(default=timezone.now)
    paired_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()  # Auto-expire after 10 minutes
    
    class Meta:
        db_table = 'bluetooth_shares'
        ordering = ['-initiated_at']
        indexes = [
            models.Index(fields=['session_code', 'status']),
            models.Index(fields=['sender', 'initiated_at']),
            models.Index(fields=['expires_at', 'status']),
        ]
    
    def __str__(self):
        return f"{self.sender.username} - {self.session_code} - {self.status}"
    
    @staticmethod
    def generate_session_code():
        """Generate a 6-digit pairing code"""
        return ''.join([str(secrets.randbelow(10)) for _ in range(6)])
    
    def is_valid(self):
        """Check if Bluetooth share session is still valid"""
        return (
            self.status not in ['completed', 'failed', 'cancelled'] and
            timezone.now() < self.expires_at
        )


# NEW: File upload generation tracking
class FileGenerationJob(models.Model):
    """Track AI flashcard generation from uploaded files"""
    STATUS_CHOICES = [
        ('processing', 'Processing'),
        ('completed', 'Completed'),
        ('failed', 'Failed'),
    ]
    
    id = models.CharField(max_length=255, primary_key=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='file_generation_jobs')
    
    # File details
    filename = models.CharField(max_length=255)
    file_type = models.CharField(max_length=50)  # pdf, docx, pptx
    file_size = models.IntegerField()  # bytes
    
    # Generation status
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='processing')
    error_message = models.TextField(null=True, blank=True)
    
    # Result
    flashcard_set = models.ForeignKey(
        FlashcardSet, 
        on_delete=models.SET_NULL, 
        null=True, 
        blank=True,
        related_name='generation_job'
    )
    cards_generated = models.IntegerField(default=0)
    
    # Timestamps
    created_at = models.DateTimeField(default=timezone.now)
    completed_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        db_table = 'file_generation_jobs'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'status']),
            models.Index(fields=['user', 'created_at']),
        ]
    
    def __str__(self):
        return f"{self.user.username} - {self.filename} - {self.status}"
    
