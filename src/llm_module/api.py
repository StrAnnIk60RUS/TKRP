"""API endpoint для обработки данных через LLM"""
from flask import Flask, request, jsonify
from flask_cors import CORS
import json
from llm_handler import YandexLLMHandler
from config import API_HOST, API_PORT, DEBUG

app = Flask(__name__)
CORS(app)  # Разрешаем CORS для фронтенда

llm_handler = None

def init_llm_handler():
    """Инициализация LLM обработчика"""
    global llm_handler
    try:
        llm_handler = YandexLLMHandler()
        return True
    except Exception as e:
        print(f"Ошибка инициализации LLM handler: {e}")
        return False

@app.route('/health', methods=['GET'])
def health():
    """Проверка работоспособности API"""
    return jsonify({"status": "ok", "llm_initialized": llm_handler is not None})

@app.route('/api/llm/process', methods=['POST'])
def process_data():
    """
    Обработка данных через LLM
    
    Принимает:
    {
        "project_input": {...},
        "competitors_data": {...}
    }
    
    Возвращает:
    {
        "success": true/false,
        "data": {...},  // контент-план
        "error": "..."  // если success = false
    }
    """
    if llm_handler is None:
        return jsonify({
            "success": False,
            "error": "LLM handler не инициализирован. Проверьте настройки API ключей."
        }), 500
    
    try:
        # Получаем данные из запроса
        data = request.get_json()
        
        if not data:
            return jsonify({
                "success": False,
                "error": "Данные не получены"
            }), 400
        
        # Проверяем наличие обязательных полей
        if 'project_input' not in data:
            return jsonify({
                "success": False,
                "error": "Отсутствует поле 'project_input'"
            }), 400
        
        if 'competitors_data' not in data:
            return jsonify({
                "success": False,
                "error": "Отсутствует поле 'competitors_data'"
            }), 400
        
        project_data = data['project_input']
        competitors_data = data['competitors_data']
        
        # Обрабатываем данные через LLM
        result = llm_handler.process_full_pipeline(project_data, competitors_data)
        
        return jsonify({
            "success": True,
            "data": result
        })
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

@app.route('/api/llm/enrich', methods=['POST'])
def enrich_competitors():
    """
    Обогащение данных конкурентов (первый этап)
    
    Принимает:
    {
        "competitors_data": {...}  // сырые данные от парсера
    }
    
    Возвращает:
    {
        "success": true/false,
        "data": {...},  // обогащенные данные
        "error": "..."  // если success = false
    }
    """
    if llm_handler is None:
        return jsonify({
            "success": False,
            "error": "LLM handler не инициализирован. Проверьте настройки API ключей."
        }), 500
    
    try:
        data = request.get_json()
        
        if not data or 'competitors_data' not in data:
            return jsonify({
                "success": False,
                "error": "Отсутствует поле 'competitors_data'"
            }), 400
        
        competitors_data = data['competitors_data']
        
        # Обогащаем данные
        enriched_data = llm_handler.enrich_competitors_data(competitors_data)
        
        return jsonify({
            "success": True,
            "data": enriched_data
        })
        
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500

if __name__ == '__main__':
    if init_llm_handler():
        print(f"LLM API сервер запущен на http://{API_HOST}:{API_PORT}")
        app.run(host=API_HOST, port=API_PORT, debug=DEBUG)
    else:
        print("Ошибка инициализации. Проверьте настройки в .env файле")
