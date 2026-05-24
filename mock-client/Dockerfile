FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY mock_http.py ./
COPY sample-images ./sample-images

ENV FLASK_URL=http://flask-server:5000/api/predict-harvest \
    IMAGES_DIR=/app/sample-images \
    INTERVAL=5 \
    COUNT=0

CMD ["python", "mock_http.py"]
