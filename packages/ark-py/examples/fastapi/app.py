import os
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, File, Request, UploadFile

from ark_py import AsyncArk


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with AsyncArk(os.environ["ARK_API_TOKEN"]) as ark:
        app.state.ark = ark
        yield


app = FastAPI(lifespan=lifespan)


@app.post("/uploads", status_code=201)
async def upload(request: Request, incoming: Annotated[UploadFile, File()]):
    # SpooledTemporaryFile is seekable, so the SDK infers its remaining size.
    file = await request.app.state.ark.files.upload(
        incoming.file,
        filename=incoming.filename or "upload",
        content_type=incoming.content_type,
    )
    return {"id": file.id, "url": file.url}
