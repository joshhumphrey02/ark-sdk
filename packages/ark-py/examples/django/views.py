from django.apps import apps
from django.http import JsonResponse
from django.views.decorators.http import require_POST


@require_POST
def upload(request):
    uploaded = request.FILES["file"]
    ark = apps.get_app_config("media").ark
    file = ark.files.upload(
        uploaded.file,
        size=uploaded.size,
        filename=uploaded.name,
        content_type=uploaded.content_type,
    )
    return JsonResponse({"id": file.id, "url": file.url}, status=201)
