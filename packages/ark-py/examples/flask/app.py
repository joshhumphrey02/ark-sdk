import os

from flask import Flask, current_app, jsonify, request

from ark_py import Ark


def create_app() -> Flask:
    app = Flask(__name__)
    app.extensions["ark"] = Ark(os.environ["ARK_API_TOKEN"])

    @app.post("/uploads")
    def upload():
        incoming = request.files["file"]
        incoming.stream.seek(0, 2)
        size = incoming.stream.tell()
        incoming.stream.seek(0)
        ark = current_app.extensions["ark"]
        file = ark.files.upload(
            incoming.stream,
            size=size,
            filename=incoming.filename or "upload",
            content_type=incoming.mimetype,
        )
        return jsonify(id=file.id, url=file.url), 201

    return app
