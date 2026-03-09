"""Модуль для работы с Yandex Cloud AI Agent API"""
import json
import requests
from typing import Dict, Any, Optional
from config import (
    YANDEX_CLOUD_API_KEY,
    YANDEX_CLOUD_FOLDER_ID,
    YANDEX_CLOUD_AGENT_ID,
    TEMPERATURE,
    MAX_TOKENS,
    INSTRUCTION_FILE,
    STAGE1_PROMPT_FILE
)


class YandexLLMHandler:
    """Обработчик для работы с Yandex Cloud AI Agent"""
    
    def __init__(self):
        self.api_key = YANDEX_CLOUD_API_KEY
        self.folder_id = YANDEX_CLOUD_FOLDER_ID
        self.agent_id = YANDEX_CLOUD_AGENT_ID
        self.temperature = TEMPERATURE
        self.max_tokens = MAX_TOKENS
        
        if not self.api_key or not self.folder_id:
            raise ValueError("YANDEX_CLOUD_API_KEY и YANDEX_CLOUD_FOLDER_ID должны быть установлены")
    
    def _load_instruction(self) -> str:
        """Загружает инструкцию для агента из файла"""
        try:
            with open(INSTRUCTION_FILE, 'r', encoding='utf-8') as f:
                return f.read()
        except FileNotFoundError:
            raise FileNotFoundError(f"Файл инструкции не найден: {INSTRUCTION_FILE}")
    
    def _load_stage1_prompt(self) -> str:
        """Загружает промпт для первого этапа из файла"""
        try:
            with open(STAGE1_PROMPT_FILE, 'r', encoding='utf-8') as f:
                content = f.read()
                # Извлекаем только промпт из markdown файла
                if '```text' in content:
                    start = content.find('```text') + 7
                    end = content.find('```', start)
                    return content[start:end].strip()
                return content
        except FileNotFoundError:
            raise FileNotFoundError(f"Файл промпта не найден: {STAGE1_PROMPT_FILE}")
    
    def _send_request_to_agent(self, prompt: str) -> Dict[str, Any]:
        """
        Отправляет запрос в Yandex Cloud AI Agent
        
        Использует REST API для работы с AI Agent
        Документация: https://cloud.yandex.ru/docs/foundation-models/concepts/ai-agent
        """
        url = f"https://llm.api.cloud.yandex.net/foundationModels/v1/completion"
        
        headers = {
            "Authorization": f"Api-Key {self.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "modelUri": f"gpt://{self.folder_id}/{self.agent_id}",
            "completionOptions": {
                "stream": False,
                "temperature": self.temperature,
                "maxTokens": str(self.max_tokens)
            },
            "messages": [
                {
                    "role": "user",
                    "text": prompt
                }
            ]
        }
        
        try:
            response = requests.post(url, headers=headers, json=payload, timeout=300)
            response.raise_for_status()
            
            result = response.json()
            
            # Извлекаем текст ответа
            if 'result' in result and 'alternatives' in result['result']:
                text = result['result']['alternatives'][0]['message']['text']
                return {"success": True, "text": text}
            else:
                return {"success": False, "error": "Неожиданный формат ответа от API"}
                
        except requests.exceptions.RequestException as e:
            return {"success": False, "error": f"Ошибка запроса к API: {str(e)}"}
        except json.JSONDecodeError as e:
            return {"success": False, "error": f"Ошибка парсинга JSON ответа: {str(e)}"}
    
    def enrich_competitors_data(self, competitors_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Обогащает данные конкурентов (первый этап)
        Определяет content_category и tone для каждого поста
        """
        # Загружаем промпт для первого этапа
        stage1_prompt = self._load_stage1_prompt()
        
        # Формируем полный промпт с данными
        full_prompt = f"""{stage1_prompt}

Входные данные:
{json.dumps(competitors_data, ensure_ascii=False, indent=2)}
"""
        
        # Отправляем запрос
        result = self._send_request_to_agent(full_prompt)
        
        if not result["success"]:
            raise Exception(f"Ошибка обогащения данных: {result.get('error', 'Неизвестная ошибка')}")
        
        # Парсим JSON из ответа
        try:
            # Извлекаем JSON из текста ответа
            text = result["text"].strip()
            
            # Удаляем markdown код блоки если есть
            if text.startswith('```json'):
                text = text[7:]
            if text.startswith('```'):
                text = text[3:]
            if text.endswith('```'):
                text = text[:-3]
            text = text.strip()
            
            enriched_data = json.loads(text)
            return enriched_data
            
        except json.JSONDecodeError as e:
            raise Exception(f"Ошибка парсинга JSON ответа: {str(e)}\nОтвет: {result['text'][:500]}")
    
    def process_full_pipeline(self, project_data: Dict[str, Any], competitors_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Полная обработка данных через LLM:
        1. Обогащение данных конкурентов
        2. Создание онтологии
        3. Генерация контент-плана
        """
        # Загружаем основную инструкцию
        instruction = self._load_instruction()
        
        # Объединяем данные
        combined_data = {
            "project_input": project_data,
            "competitors_data": competitors_data,
            "processing_metadata": {
                "combined_at": json.dumps({"$date": "now"}, default=str)
            }
        }
        
        # Формируем полный промпт
        full_prompt = f"""{instruction}

Входные данные:
{json.dumps(combined_data, ensure_ascii=False, indent=2)}
"""
        
        # Отправляем запрос
        result = self._send_request_to_agent(full_prompt)
        
        if not result["success"]:
            raise Exception(f"Ошибка обработки данных: {result.get('error', 'Неизвестная ошибка')}")
        
        # Парсим JSON из ответа
        try:
            text = result["text"].strip()
            
            # Удаляем markdown код блоки если есть
            if text.startswith('```json'):
                text = text[7:]
            if text.startswith('```'):
                text = text[3:]
            if text.endswith('```'):
                text = text[:-3]
            text = text.strip()
            
            content_plan = json.loads(text)
            return content_plan
            
        except json.JSONDecodeError as e:
            raise Exception(f"Ошибка парсинга JSON ответа: {str(e)}\nОтвет: {result['text'][:500]}")
