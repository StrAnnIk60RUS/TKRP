"""Конфигурация для LLM модуля (провайдер-агностичный)"""
import os
from dotenv import load_dotenv

load_dotenv()

# Общие LLM настройки (без привязки к Yandex)
LLM_API_KEY = os.getenv('LLM_API_KEY', '')
LLM_PROJECT_ID = os.getenv('LLM_PROJECT_ID', '')
LLM_AGENT_ID = os.getenv('LLM_AGENT_ID', '')

# Настройки модели
LLM_MODEL = os.getenv('LLM_MODEL', 'gpt/latest')
TEMPERATURE = float(os.getenv('TEMPERATURE', '0.4'))
MAX_TOKENS = int(os.getenv('MAX_TOKENS', '6000'))

# Пути к файлам
INSTRUCTION_FILE = os.path.join(os.path.dirname(__file__), '..', '..', 'YANDEX_CLOUD_AGENT_INSTRUCTION.txt')
STAGE1_PROMPT_FILE = os.path.join(os.path.dirname(__file__), '..', '..', 'LLM_PROMPT_STAGE1.md')

# Настройки API сервера
API_HOST = os.getenv('API_HOST', 'localhost')
API_PORT = int(os.getenv('API_PORT', '5000'))
DEBUG = os.getenv('DEBUG', 'False').lower() == 'true'
