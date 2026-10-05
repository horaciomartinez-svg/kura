### **Módulo 1: Descubrimiento y Arquitectura**

El MVP de KURA se estructura bajo un estándar de **Arquitectura Orientada a Eventos (EDA) y Microservicios Serverless** para garantizar escalabilidad masiva y latencia mínima sin costos fijos de infraestructura. Este diseño responde a la necesidad de una plataforma SaaS rápida, minimalista y eficiente para campañas de correo profesionales.

#### **Stack Tecnológico Sugerido**

| Capa | Tecnología Seleccionada | Justificación Técnica |
| :---- | :---- | :---- |
| **Frontend Web** | Next.js (React) con TypeScript | Soporte nativo para SSR/SSG, ideal para el Dashboard y optimización del editor visual *drag & drop*. |
| **Estilos UI** | Tailwind CSS | Sistema de utilidades para implementar exactamente el diseño minimalista de bordes de 6px-8px. |
| **Backend API** | Cloudflare Workers | Ejecución de funciones en el *Edge* (servidores distribuidos), reduciendo la latencia a milisegundos. |
| **Base de Datos** | Supabase (PostgreSQL) | Motor relacional robusto para mantener la integridad referencial en operaciones multi-tenant. |
| **Motor Asíncrono** | Cloudflare Queues | Arquitectura Productor-Consumidor para absorber picos masivos de contactos sin agotar la conexión HTTP. |
| **Infraestructura Core** | AWS SES \+ Amazon SNS | Salida de correos vía API y recepción de webhooks de telemetría (aperturas, clics, rebotes). |

#### **Diagrama de Arquitectura (Mermaid)**

Fragmento de código  
graph TD  
    %% Frontend  
    subgraph Cliente Web  
        UI\[Next.js Frontend\]  
        Editor\[Campaign Builder JSON\]  
    end

    %% Cloudflare Edge  
    subgraph Cloudflare Edge Network  
        API\[Workers: Main API\]  
        Track\[Workers: TrackingEngine\]  
        Prod\[Workers: Productor de Envíos\]  
        Queue\[(Cloudflare Queues)\]  
        Cons\[Workers: Consumidor Batch\]  
    end

    %% Base de Datos  
    subgraph Almacenamiento Relacional  
        DB\[(Supabase PostgreSQL)\]  
    end

    %% Infraestructura Externa  
    subgraph AWS Cloud  
        SES\[AWS SES\]  
        SNS\[Amazon SNS Webhooks\]  
    end

    %% Relaciones  
    UI \--\>|HTTP POST / GET| API  
    Editor \--\>|Guarda JSON| API  
    API \<--\>|Lee/Escribe SQL| DB  
    UI \--\>|Gatilla Envío| Prod  
    Prod \--\>|Encola Lotes| Queue  
    Queue \--\>|Push Asíncrono| Cons  
    Cons \--\>|Compila MJML a HTML| Cons  
    Cons \--\>|Llama API Bulk| SES  
    Track \--\>|Registra Opens/Clicks| DB  
    SES \--\>|Eventos de Entrega| SNS  
    SNS \--\>|Webhooks Bounces/Complaints| API

### **Módulo 2: Diseño de Datos**

El diseño de datos separa los contactos globales de las inscripciones a listas específicas, e integra las tablas necesarias para las métricas de AWS SES y la protección anti-spam.

#### **Diagrama Entidad-Relación (Mermaid)**

Fragmento de código  
erDiagram  
    users ||--o{ lists : "crea"  
    users ||--o{ contacts : "posee"  
    users ||--o{ campaigns : "envía"  
    users ||--o{ verified\_domains : "registra"  
    lists ||--o{ list\_memberships : "contiene"  
    contacts ||--o{ list\_memberships : "pertenece"  
    campaigns ||--o{ campaign\_events : "genera"  
    contacts ||--o{ campaign\_events : "dispara"

    users {  
        uuid id PK  
        string email  
        string status "active, suspended"  
        int trial\_sends\_count "Max 50"  
        timestamp trial\_expires\_at  
    }  
    verified\_domains {  
        uuid id PK  
        uuid user\_id FK  
        string domain\_name  
        json dkim\_tokens  
        string status "pending, verified, failed"  
    }  
    campaigns {  
        uuid id PK  
        uuid user\_id FK  
        uuid list\_id FK  
        string from\_email  
        json design\_json  
        string status "draft, scheduled, sending, sent, paused\_trial\_expired"  
    }

#### **Script DDL (PostgreSQL)**

SQL  
\-- Habilitar extensión UUID  
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\-- Tabla: users  
CREATE TABLE users (  
    id UUID PRIMARY KEY DEFAULT uuid\_generate\_v4(),  
    email VARCHAR(255) UNIQUE NOT NULL,  
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'suspended')),  
    trial\_sends\_count INT DEFAULT 0 CHECK (trial\_sends\_count \<= 50),  
    trial\_expires\_at TIMESTAMP WITH TIME ZONE NOT NULL,  
    created\_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT\_TIMESTAMP  
);

\-- Tabla: verified\_domains  
CREATE TABLE verified\_domains (  
    id UUID PRIMARY KEY DEFAULT uuid\_generate\_v4(),  
    user\_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  
    domain\_name VARCHAR(255) NOT NULL,  
    dkim\_tokens JSONB NOT NULL,  
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed')),  
    created\_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT\_TIMESTAMP,  
    UNIQUE(user\_id, domain\_name)  
);

\-- Tabla: lists  
CREATE TABLE lists (  
    id UUID PRIMARY KEY DEFAULT uuid\_generate\_v4(),  
    user\_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  
    name VARCHAR(255) NOT NULL,  
    created\_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT\_TIMESTAMP  
);

\-- Tabla: contacts  
CREATE TABLE contacts (  
    id UUID PRIMARY KEY DEFAULT uuid\_generate\_v4(),  
    user\_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  
    email VARCHAR(255) NOT NULL,  
    first\_name VARCHAR(100),  
    last\_name VARCHAR(100),  
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'bounced', 'unsubscribed')),  
    created\_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT\_TIMESTAMP,  
    UNIQUE(user\_id, email)  
);

\-- Tabla Puente: list\_memberships  
CREATE TABLE list\_memberships (  
    list\_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,  
    contact\_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,  
    joined\_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT\_TIMESTAMP,  
    PRIMARY KEY (list\_id, contact\_id)  
);

\-- Tabla: campaigns  
CREATE TABLE campaigns (  
    id UUID PRIMARY KEY DEFAULT uuid\_generate\_v4(),  
    user\_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,  
    list\_id UUID REFERENCES lists(id) ON DELETE SET NULL,  
    name VARCHAR(255) NOT NULL,  
    from\_email VARCHAR(255) NOT NULL,  
    subject VARCHAR(255),  
    design\_json JSONB,  
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'preparing', 'sending', 'sent', 'paused\_trial\_expired')),  
    scheduled\_at TIMESTAMP WITH TIME ZONE,  
    completed\_at TIMESTAMP WITH TIME ZONE,  
    created\_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT\_TIMESTAMP  
);

\-- Tabla: campaign\_events (Edge Tracking)  
CREATE TABLE campaign\_events (  
    id UUID PRIMARY KEY DEFAULT uuid\_generate\_v4(),  
    campaign\_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,  
    contact\_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,  
    event\_type VARCHAR(50) NOT NULL CHECK (event\_type IN ('open', 'click', 'bounce', 'complaint')),  
    url\_clicked TEXT,  
    is\_machine\_open BOOLEAN DEFAULT FALSE,  
    created\_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT\_TIMESTAMP  
);

### **Módulo 3: Lógica y Estructura de Archivos**

Para garantizar el despliegue mediante CI/CD sin interrupciones, el repositorio se divide lógicamente entre el entorno de Next.js (Frontend desplegado en Cloudflare Pages) y el ecosistema de Workers.

#### **Mapa del Sistema de Archivos (Monorepo Estructurado)**

Plaintext  
kura-monorepo/  
├── apps/  
│   ├── web/                     \# Next.js Frontend  
│   │   ├── src/  
│   │   │   ├── app/             \# App Router (Pages)  
│   │   │   ├── components/      \# Atomic UI Components  
│   │   │   │   ├── DomainVerificationPanel.tsx  
│   │   │   │   ├── MainDashboard.tsx  
│   │   │   │   └── CampaignBuilder/  
│   │   │   ├── store/           \# Zustand (JSON State)  
│   │   │   └── lib/             \# API Clients & Utils  
│   │   └── tailwind.config.ts  
│   └── api-workers/             \# Cloudflare Workers Backend  
│       ├── src/  
│       │   ├── handlers/        \# HTTP Route Controllers  
│       │   ├── queues/          \# Consumer Logic (Async Engine)  
│       │   ├── tracking/        \# Edge Tracker (Opens/Clicks)  
│       │   └── db/              \# Drizzle ORM / Supabase Clients  
│       ├── wrangler.toml        \# Configuración de Workers y Queues  
│       └── package.json  
├── packages/  
│   ├── core/                    \# Shared TypeScript Interfaces  
│   └── ui/                      \# Shared UI Assets  
└── .github/workflows/           \# CI/CD Pipelines (Frontend & Backend)

#### **Diagrama de Flujo Asíncrono (AWS SES \+ Cloudflare Queues)**

Fragmento de código  
sequenceDiagram  
    participant User as Usuario (UI)  
    participant API as Worker Productor  
    participant DB as PostgreSQL  
    participant Queue as Cloudflare Queues  
    participant Cons as Worker Consumidor  
    participant SES as AWS SES

    User-\>\>API: POST /api/campaigns/:id/send  
    API-\>\>DB: Validar estado 'trial' y saldo (Max 50\)  
    API-\>\>DB: UPDATE status \= 'preparing'  
    API-\>\>DB: SELECT contacts FROM list\_memberships  
    loop Paginación (100 por lote)  
        API-\>\>Queue: Push { campaign\_id, contact\_id, variables }  
    end  
    API-\>\>DB: UPDATE status \= 'sending'  
    API--\>\>User: 202 Accepted (Campaña en proceso)

    Note over Queue, Cons: Procesamiento en Segundo Plano  
    Queue-\>\>Cons: Consume Batch de Mensajes (Max RPS: 14\)  
    Cons-\>\>Cons: Convierte JSON a MJML \-\> HTML  
    Cons-\>\>Cons: Reemplaza Merge Tags (ej. {{nombre}})  
    Cons-\>\>SES: POST SendBulkTemplatedEmail  
    SES--\>\>Cons: 200 OK (Message IDs)  
      
    opt Último Lote Completado  
        Cons-\>\>DB: UPDATE status \= 'sent', completed\_at \= NOW()  
    end

#### **Contratos de Interfaces (TypeScript \- packages/core/types.ts)**

TypeScript  
export interface TrialStatus {  
  isTrial: boolean;  
  daysRemaining: number;  
  sendsUsed: number;  
  sendsLimit: number;  
  isLocked: boolean; // true si daysRemaining \< 0  
}

export interface DomainVerificationState {  
  domain: string;  
  status: 'pending' | 'verified' | 'failed';  
  records: {  
    type: 'CNAME' | 'TXT';  
    host: string;  
    value: string;  
  }\[\];  
}

export interface CampaignBuilderState {  
  version: string;  
  body: {  
    backgroundColor: string;  
    contentWidth: string;  
    blocks: Array\<{  
      type: 'text' | 'image' | 'button' | 'divider';  
      properties: Record\<string, any\>;  
    }\>;  
  };  
}

### **Módulo 4: Diseño de Interfaz (UI/UX)**

La plataforma proyecta un minimalismo vibrante con alta legibilidad, utilizando esquinas de 6px a 8px para una estética pulida.

#### **Guía de Estilo Estricta**

| Elemento | Especificación | Uso Asignado |
| :---- | :---- | :---- |
| **Primario** | Verde Esmeralda (\#014751) | Botones de acción principales, estado verificado, gráficos (línea). |
| **Acento** | Verde Menta (\#AFFECA) | Alertas sutiles, rellenos de gráficos, hover states, bordes de *dropzones*. |
| **Fondo** | Gris Hielo (\#F7F9FC) | Fondo de la aplicación y del canvas del editor. |
| **Texto/Fondos Oscuros** | Gris Carbón (\#111827) | Tipografía general, barra superior del *Top Banner* de prueba. |
| **Tipografía (Títulos)** | Clash Display | KPIs numéricos, marca, modales de bloqueo. |
| **Tipografía (Cuerpo)** | Inter | Tablas de datos, configuraciones, listas de usuarios. |
| **Bordes y Sombras** | rounded-md a rounded-xl | Componentes estructurados con sombras ultra sutiles (0px 4px 6px rgba(0,0,0,0.05)). |

#### **Especificaciones Estructurales de Pantallas**

> 1. **Dashboard (MainDashboard)**  
   * **KPIs:** 4 tarjetas blancas superiores (Total Suscriptores, Tasa de Apertura, CTR, Rebotes). Rebotes \> 2% en ámbar/rojo.  
   * **Gráfico:** *Area Chart* (Recharts) sin grid lines. Aperturas en gradiente \#AFFECA a transparente; Clics en gris oscuro.  
   * **Tabla:** Historial de campañas recientes (Nombre, Badge de Estado, Barra de progreso de aperturas).  
> 2. **Verificación de Dominio (DomainVerificationPanel)**  
   * **UX Prevención de Errores:** Bloque gris educativo advirtiendo sobre sufijos automáticos en GoDaddy/Namecheap.  
   * **Tabla:** Valores DNS monoespaciados en fondos \#F7F9FC de solo lectura.  
   * **Copiado Seguro:** Interacción obligatoria mediante botón de portapapeles que cambia a check verde temporalmente.  
> 3. **Editor de Correos (CampaignBuilder)**  
   * **Gestor de Interfaz:** Layout *Full-height* sin scroll principal. Panel izquierdo de 300px (Bloques y Estilos).  
   * **Canvas:** Área central de 600px de ancho simulando papel con bordes punteados \#AFFECA al arrastrar elementos.  
> 4. **Paywall Trial (Soft Lock)**  
   * **Estado Activo (Días 5-7):** *Top Banner* oscuro (\#111827) con texto verde menta advirtiendo caducidad.  
   * **Estado Bloqueado (Día 8+):** Botones de envío con opacidad 50%. Modal superpuesto con *blur* interceptando intenciones de escritura, mostrando resumen dinámico y botón \#014751 "Actualizar a Pro".

#### **Wireframe Jerárquico de Componentes (Mermaid)**

Fragmento de código  
mindmap  
  root((KURA UI))  
    Layout Principal  
      TopBanner\_Trial\_Warning  
      SidebarNavigation  
    Dashboard  
      Header\_Saludo  
      MetricCardsGrid  
        Card\_Suscriptores  
        Card\_OpenRate  
        Card\_CTR  
        Card\_Bounces\_Alerta  
      PerformanceAreaChart  
      RecentCampaignsTable  
    Configuracion  
      DomainVerificationPanel  
        Alert\_InfoSufijos  
        DNSRecordsTable  
          CopyClipboardButton  
        VerifyStatusBadge  
        Accordion\_Tutorials  
    Editor  
      TopBar\_Acciones  
      LeftSidebar\_Herramientas  
        Tab\_Blocks  
        Tab\_Styles  
      Canvas\_DragAndDrop  
        Dropzone\_Indicator  
    Modales  
      TrialExpired\_SoftLock  
        BlurOverlay  
        SummaryStats  
        CTA\_ContactSupport

Con la arquitectura y el diseño técnico aprobados, iniciamos la **Fase de Bootstrapping e Implementación**. Dado que utilizarás Opencode CLI y Qwen2.5 1.5B, el paso fundamental es establecer los archivos de configuración maestros que gobernarán el monorepo. Estos archivos definen la infraestructura como código (IaC) para Cloudflare y el sistema de diseño estricto para el frontend.

### **1\. Configuración de Infraestructura Backend (**api-workers/wrangler.toml**)**

Este archivo instruye a Cloudflare sobre cómo desplegar tus microservicios, configurando el límite de concurrencia de la cola (para no exceder los límites de AWS SES) y los *bindings* para la base de datos relacional.

Ini, TOML

```

name = "kura-api-core"
main = "src/index.ts"
compatibility_date = "2024-03-20"

# Variables de entorno planas (Las credenciales de AWS SES deben ir en .dev.vars o Secrets)
[vars]
ENVIRONMENT = "production"
AWS_REGION = "us-east-1"
# Limitar correos de prueba a 50
MAX_TRIAL_SENDS = 50 

# Configuración del Productor: Hacia dónde empuja mensajes la API
[[queues.producers]]
queue = "kura-sending-queue"
binding = "SENDING_QUEUE"

# Configuración del Consumidor: Cómo el Worker procesa la cola
[[queues.consumers]]
queue = "kura-sending-queue"
max_batch_size = 10           # Procesa de 10 en 10 para BulkTemplatedEmail
max_batch_timeout = 5         # Espera máximo 5 segundos para llenar el lote
max_retries = 3               # Tolerancia a fallos de red con AWS SES
dead_letter_queue = "kura-dlq"

# Conexión a Base de Datos (Si usas Cloudflare D1 localmente o Hyperdrive para Supabase)
# Para Supabase (PostgreSQL) usando conexión TCP directa desde el Edge
[[hyperdrive]]
binding = "DB_POOL"
id = "kura-supabase-pool-id"

```

### **2\. Sistema de Diseño Frontend (**web/tailwind.config.ts**)**

Este archivo implementa la guía de estilo estricta de KURA, inyectando la paleta de colores y las familias tipográficas para asegurar que el modelo de IA genere la UI exactamente como se diseñó.

TypeScript

```

import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Paleta Institucional KURA
        primary: {
          DEFAULT: '#014751', // Verde Esmeralda
          hover: '#01363E',
        },
        accent: {
          DEFAULT: '#AFFECA', // Verde Menta
          hover: '#95E3B3',
        },
        surface: {
          DEFAULT: '#F7F9FC', // Gris Hielo (Fondos)
          card: '#FFFFFF',
        },
        typography: {
          DEFAULT: '#111827', // Gris Carbón
          muted: '#6B7280',
        }
      },
      fontFamily: {
        heading: ['Clash Display', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        mono: ['Fira Code', 'monospace'],
      },
      borderRadius: {
        'kura-sm': '6px',
        'kura-md': '8px',
        'kura-lg': '12px',
      },
      boxShadow: {
        'kura-soft': '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)',
      }
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
  ],
}
export default config

```

### **3\. Dependencias Estratégicas (**package.json **resumido)**

Asegúrate de instruir a Opencode CLI que instale los siguientes paquetes para garantizar el funcionamiento del Editor y la Base de Datos:

* **Frontend:** zustand (gestión de estado del editor JSON), recharts (gráficos del dashboard), @hello-pangea/dnd o react-beautiful-dnd (interacciones drag & drop), lucide-react (iconografía minimalista).  
*   
* **Backend:** mjml (compilador de JSON a HTML compatible con email), @aws-sdk/client-ses (SDK modular de AWS), drizzle-orm (ORM edge-compatible).


Recomiendo priorizar el **Motor Asíncrono de Envíos (Workers \+ Queues)**. Es el núcleo crítico del MVP y representa el mayor riesgo técnico; si la orquestación de colas y los límites de tasa (Rate Limiting) con AWS SES no son robustos desde el día uno, el frontend no tendrá utilidad y la reputación del dominio se verá comprometida.

A continuación, detallo la implementación de bajo nivel para este microservicio.

### **Estructura del Microservicio Asíncrono**

Plaintext

```

apps/api-workers/src/
├── index.ts               # Punto de entrada (Router y Queue Handler)
├── types/
│   └── env.d.ts           # Definición de variables de entorno y bindings
├── handlers/
│   └── sendCampaign.ts    # Productor: API Endpoint que encola mensajes
└── queues/
    └── emailConsumer.ts   # Consumidor: Procesa lotes y llama a AWS SES

```

### **1\. Definición de Entorno y Contratos (**types/env.d.ts**)**

TypeScript

```

import { Queue } from '@cloudflare/workers-types';

export interface Env {
  // Variables estáticas
  ENVIRONMENT: string;
  AWS_REGION: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  
  // Bindings de Cloudflare
  SENDING_QUEUE: Queue<QueuePayload>;
  DB_POOL: any; // Binding a Hyperdrive (PostgreSQL) o D1
}

// Contrato estricto para los mensajes encolados
export interface QueuePayload {
  campaignId: string;
  contactId: string;
  contactEmail: string;
  contactVars: Record<string, string>;
  fromEmail: string;
  designJson: any; // Payload del diseño para compilar
}

```

### **2\. El Productor: Ingesta y Encolado (**handlers/sendCampaign.ts**)**

Este controlador recibe la petición HTTP, valida las reglas de negocio (Límites del Trial) y realiza un *push* masivo hacia la cola sin bloquear la respuesta al usuario.

TypeScript

```

import { Env, QueuePayload } from '../types/env';

export async function handleSendCampaign(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const campaignId = url.pathname.split('/')[3]; 
  
  // 1. (Simulación) Query a la DB: Validar estado de la campaña y usuario
  // const campaign = await db.query('SELECT * FROM campaigns WHERE id = $1', [campaignId]);
  // if (campaign.status !== 'draft') return new Response('Invalid status', { status: 400 });

  // 2. (Simulación) Query a la DB: Obtener contactos de la lista
  // const contacts = await db.query('SELECT * FROM list_memberships JOIN contacts...');
  
  // Mock de contactos obtenidos de la base de datos
  const activeContacts = [
    { id: 'c-1', email: 'user1@example.com', vars: { nombre: 'Juan' } },
    { id: 'c-2', email: 'user2@example.com', vars: { nombre: 'Ana' } }
  ];

  // 3. Encolamiento por lotes hacia Cloudflare Queues
  const messagesToQueue = activeContacts.map(contact => ({
    body: {
      campaignId,
      contactId: contact.id,
      contactEmail: contact.email,
      contactVars: contact.vars,
      fromEmail: 'hola@midominio.com',
      designJson: {} // JSON del editor
    } as QueuePayload
  }));

  // Utiliza el método sendBatch para mayor eficiencia en el Edge
  await env.SENDING_QUEUE.sendBatch(messagesToQueue);

  // 4. (Simulación) Actualizar estado en DB a 'sending'
  // await db.query('UPDATE campaigns SET status = $1 WHERE id = $2', ['sending', campaignId]);

  return new Response(JSON.stringify({ 
    message: 'Campaign processing started', 
    enqueued: messagesToQueue.length 
  }), { 
    status: 202, 
    headers: { 'Content-Type': 'application/json' } 
  });
}

```

### **3\. El Consumidor: Procesamiento y AWS SES (**queues/emailConsumer.ts**)**

Este módulo se ejecuta en *background*. Extrae los lotes (configurados previamente de 10 en 10), compila el diseño (MJML) y hace una única llamada a la API Bulk de AWS SES para reducir costos de invocación y respetar los límites por segundo.

TypeScript

```

import { MessageBatch } from '@cloudflare/workers-types';
import { Env, QueuePayload } from '../types/env';
import { SESClient, SendBulkTemplatedEmailCommand } from '@aws-sdk/client-ses';

export async function processEmailQueue(batch: MessageBatch<QueuePayload>, env: Env): Promise<void> {
  // Inicializar cliente de AWS SES en el Edge
  const sesClient = new SESClient({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    }
  });

  const destinations = batch.messages.map(msg => {
    // Aquí se inyecta la lógica de reemplazo de variables (Merge Tags)
    const replacementData = JSON.stringify({
      nombre: msg.body.contactVars.nombre || 'Suscriptor'
    });

    return {
      Destination: { ToAddresses: [msg.body.contactEmail] },
      ReplacementTemplateData: replacementData
    };
  });

  try {
    // Compilar MJML a HTML (Lógica abstraída para este ejemplo)
    // const compiledHtml = mjml2html(batch.messages[0].body.designJson).html;

    const command = new SendBulkTemplatedEmailCommand({
      Source: batch.messages[0].body.fromEmail,
      Template: 'KuraDynamicTemplate', // Requiere pre-crear un template en SES
      DefaultTemplateData: JSON.stringify({ nombre: '' }),
      Destinations: destinations,
    });

    const response = await sesClient.send(command);
    
    console.log(`Lote procesado. SES Message ID: ${response.Status?.[0]?.MessageId}`);

    // Confirmar a la cola que los mensajes fueron procesados exitosamente
    batch.ackAll();

  } catch (error) {
    console.error('Error procesando lote de correos:', error);
    // Permite que la política de reintentos (max_retries) vuelva a procesar este lote
    batch.retryAll();
  }
}

```

### **4\. Punto de Entrada (Router Principal) (**index.ts**)**

Conecta el tráfico HTTP y los eventos de la cola hacia sus respectivos controladores.

TypeScript

```

import { handleSendCampaign } from './handlers/sendCampaign';
import { processEmailQueue } from './queues/emailConsumer';
import { Env } from './types/env';

export default {
  // Manejador de tráfico web (API)
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname.match(/^\/api\/campaigns\/[^\/]+\/send$/)) {
      return handleSendCampaign(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },

  // Manejador del suscriptor a la cola
  async queue(batch: MessageBatch<QueuePayload>, env: Env, ctx: ExecutionContext): Promise<void> {
    await processEmailQueue(batch, env);
  }
};

```

El sistema de telemetría (TrackingEngine) es el componente analítico central, diseñado para ejecutarse en el *Edge* de Cloudflare para garantizar respuestas en menos de 10 milisegundos y soportar picos masivos de tráfico. Este módulo opera de forma asíncrona mediante la función ctx.waitUntil() de Cloudflare Workers, lo que permite despachar eventos hacia una cola sin bloquear la respuesta al cliente final.

### **Arquitectura de Telemetría (Edge Tracking)**

* **Mutación Pre-Envío:** Antes de despachar el correo a AWS SES, el sistema inyecta un píxel invisible de 1x1 al final del \<body\> (GET /o/:payload.gif) y reescribe los enlaces originales (GET /c/:payload).  
* **Decodificación Eficiente:** El *payload* codifica en Base64 el campaign\_id y contact\_id de forma ofuscada para mantener la privacidad y reducir el tamaño de las URLs.  
* **Mitigación de Falsos Positivos:** El Worker identifica el *Apple Mail Privacy Protection* (AMPP) o bots corporativos analizando el User-Agent, marcando el evento con un flag is\_machine\_open: true en la base de datos para no inflar artificialmente las estadísticas del Dashboard.

### **Diagrama de Secuencia**

Fragmento de código

```

sequenceDiagram
    participant Client as Cliente de Correo
    participant Edge as Edge Tracker Worker
    participant Queue as Cloudflare Queues
    participant Cons as Worker Consumidor
    participant DB as PostgreSQL

    Client->>Edge: GET /o/:payload.gif (Apertura)
    Edge->>Edge: Decodifica payload y evalúa User-Agent (AMPP)
    Edge-->>Client: HTTP 200 (GIF 1x1 Transparente + No-Cache)
    Edge-xQueue: ctx.waitUntil(Push Tracking Event)

    Client->>Edge: GET /c/:payload (Clic)
    Edge->>Edge: Decodifica payload (URL original)
    Edge-->>Client: HTTP 302 Found (Redirección a destino)
    Edge-xQueue: ctx.waitUntil(Push Tracking Event)

    Queue->>Cons: Consume lotes de eventos
    Cons->>DB: INSERT Bulk en campaign_events

```

### **Implementación del Controlador (Edge Tracker)**

Este controlador se enfoca exclusivamente en la intercepción y despacho rápido del tráfico analítico.

TypeScript

```

// apps/api-workers/src/tracking/index.ts
import { Env } from '../types/env';

// Buffer binario estático: GIF transparente de 1x1 píxel
const PIXEL = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), c => c.charCodeAt(0));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const userAgent = request.headers.get('User-Agent') || '';
    
    // Detección de AMPP y Bots de seguridad (ej. Mimecast, Barracuda)
    const isMachineOpen = userAgent.includes('CFNetwork') || userAgent.includes('Barracuda');

    // 1. Rastreo de Aperturas (Open Tracking)
    if (request.method === 'GET' && url.pathname.startsWith('/o/')) {
      const payload = url.pathname.replace('/o/', '').replace('.gif', '');
      
      // Ingestión asíncrona sin bloquear la entrega de la imagen
      ctx.waitUntil(logEvent(env, payload, 'open', undefined, isMachineOpen));

      return new Response(PIXEL, {
        status: 200,
        headers: {
          'Content-Type': 'image/gif',
          'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        },
      });
    }

    // 2. Rastreo de Clics (Click Tracking)
    if (request.method === 'GET' && url.pathname.startsWith('/c/')) {
      const payload = url.pathname.replace('/c/', '');
      const decoded = JSON.parse(atob(payload)); // { cmp: "...", cnt: "...", url: "https..." }
      
      ctx.waitUntil(logEvent(env, payload, 'click', decoded.url, false));

      // Redirección HTTP 302 rápida al destino original
      return Response.redirect(decoded.url, 302);
    }

    return new Response('Not Found', { status: 404 });
  }
};

// Despacho a Cloudflare Queues
async function logEvent(env: Env, payloadBase64: string, type: string, url?: string, isMachineOpen?: boolean) {
  const decoded = JSON.parse(atob(payloadBase64));
  
  await env.TRACKING_QUEUE.send({
    campaign_id: decoded.cmp,
    contact_id: decoded.cnt,
    event_type: type,
    url_clicked: url || null,
    is_machine_open: isMachineOpen || false
  });
}

```

### **Consumidor de Eventos Analíticos**

El Worker consumidor retira los eventos de la cola en lotes (batching) y ejecuta un INSERT masivo de manera eficiente para registrar los eventos generados.

TypeScript

```

// apps/api-workers/src/queues/trackingConsumer.ts
import { MessageBatch } from '@cloudflare/workers-types';
import { Env } from '../types/env';

export async function processTrackingQueue(batch: MessageBatch<any>, env: Env): Promise<void> {
  // Construcción de la consulta Bulk INSERT
  const values = batch.messages.map(msg => `(
    '${msg.body.campaign_id}', 
    '${msg.body.contact_id}', 
    '${msg.body.event_type}', 
    '${msg.body.url_clicked || ''}', 
    ${msg.body.is_machine_open}
  )`).join(',');

  const query = `
    INSERT INTO campaign_events (campaign_id, contact_id, event_type, url_clicked, is_machine_open)
    VALUES ${values}
  `;

  // await db.execute(query);
  
  batch.ackAll();
}

```

Implementamos el módulo final enfocado en el Frontend web (Next.js con React) y la gestión de estado. Este ecosistema traduce el diseño UI/UX en componentes interactivos, priorizando la reducción cognitiva y la respuesta inmediata del sistema.

### **1\. Gestión de Estado Global (Zustand) para el Editor de Campañas**

Dado que el motor no guarda HTML directamente sino la representación estructural en JSON, utilizamos Zustand para mantener el árbol de componentes en memoria de forma ultra-ligera y reactiva.

TypeScript

```

// apps/web/src/store/useCampaignBuilderStore.ts
import { create } from 'zustand';

interface Block {
  id: string;
  type: 'text' | 'image' | 'button' | 'divider';
  properties: Record<string, any>;
}

interface CampaignState {
  campaignId: string | null;
  isDirty: boolean;
  design: {
    backgroundColor: string;
    contentWidth: string;
    blocks: Block[];
  };
  setCampaignId: (id: string) => void;
  addBlock: (block: Block, index?: number) => void;
  updateBlock: (id: string, properties: Record<string, any>) => void;
  removeBlock: (id: string) => void;
  saveDesign: () => Promise<void>;
}

export const useCampaignBuilderStore = create<CampaignState>((set, get) => ({
  campaignId: null,
  isDirty: false,
  design: {
    backgroundColor: '#F7F9FC',
    contentWidth: '600px',
    blocks: [],
  },
  
  setCampaignId: (id) => set({ campaignId: id }),
  
  addBlock: (block, index) => set((state) => {
    const newBlocks = [...state.design.blocks];
    if (index !== undefined) newBlocks.splice(index, 0, block);
    else newBlocks.push(block);
    return { design: { ...state.design, blocks: newBlocks }, isDirty: true };
  }),

  updateBlock: (id, properties) => set((state) => ({
    design: {
      ...state.design,
      blocks: state.design.blocks.map(b => 
        b.id === id ? { ...b, properties: { ...b.properties, ...properties } } : b
      )
    },
    isDirty: true
  })),

  removeBlock: (id) => set((state) => ({
    design: { ...state.design, blocks: state.design.blocks.filter(b => b.id !== id) },
    isDirty: true
  })),

  saveDesign: async () => {
    const { campaignId, design } = get();
    if (!campaignId) return;
    
    await fetch(`/api/campaigns/${campaignId}/design`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(design),
    });
    set({ isDirty: false });
  }
}));

```

### **2\. Panel Principal (MainDashboard)**

El Dashboard principal se estructura en 3 niveles visuales utilizando CSS Grid para ofrecer claridad instantánea sin abrumar al usuario.

TypeScript

```

// apps/web/src/components/MainDashboard.tsx
import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

// Datos simulados para el gráfico
const performanceData = [
  { date: '01 Oct', opens: 400, clicks: 24 },
  { date: '02 Oct', opens: 300, clicks: 18 },
  { date: '03 Oct', opens: 550, clicks: 45 },
];

export function MainDashboard({ userName, stats, campaigns }) {
  return (
    <div className="w-full min-h-screen bg-surface p-8 font-body text-typography">
      
      {/* Nivel 1: Header */}
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="font-heading text-3xl font-semibold">Hola, {userName} 👋</h1>
          <p className="text-typography-muted">Aquí tienes el resumen de tu rendimiento en los últimos 30 días.</p>
        </div>
        <button className="bg-primary text-white px-6 py-3 rounded-kura-md hover:bg-primary-hover transition-colors font-medium">
          Crear nueva campaña
        </button>
      </header>

      {/* Nivel 1: Tarjetas de Métricas (Top Cards) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <MetricCard title="TOTAL SUSCRIPTORES" value={stats.totalSubscribers} trend="+12%" />
        <MetricCard title="TASA DE APERTURA" value={`${stats.openRate}%`} trend="+2.4%" />
        <MetricCard title="TASA DE CLICS (CTR)" value={`${stats.ctr}%`} trend="-0.5%" />
        <MetricCard 
          title="TASA DE REBOTE" 
          value={`${stats.bounceRate}%`} 
          alert={stats.bounceRate > 2} 
        />
      </div>

      {/* Nivel 2: Gráfico Principal */}
      <div className="bg-surface-card p-6 rounded-kura-xl shadow-kura-soft mb-8 h-96">
        <h3 className="font-heading text-lg font-medium mb-6">Rendimiento Histórico</h3>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={performanceData}>
            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#6B7280' }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6B7280' }} />
            <Tooltip cursor={{ stroke: '#014751', strokeWidth: 1, strokeDasharray: '5 5' }} />
            <Area type="monotone" dataKey="opens" stroke="#014751" fill="url(#colorOpens)" strokeWidth={2} />
            <Area type="monotone" dataKey="clicks" stroke="#4B5563" fill="transparent" strokeWidth={2} />
            <defs>
              <linearGradient id="colorOpens" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#AFFECA" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="#AFFECA" stopOpacity={0}/>
              </linearGradient>
            </defs>
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Nivel 3: Historial Reciente */}
      <div className="bg-surface-card rounded-kura-xl shadow-kura-soft p-6">
        <h3 className="font-heading text-lg font-medium mb-4">Campañas Recientes</h3>
        {campaigns.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-typography-muted mb-4">Aún no has enviado ninguna campaña. ¡Rompe el hielo!</p>
            <button className="border border-primary text-primary px-4 py-2 rounded-kura-md">Empezar ahora</button>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="text-typography-muted text-sm border-b border-gray-100">
                <th className="pb-3 font-normal">Campaña</th>
                <th className="pb-3 font-normal">Estado</th>
                <th className="pb-3 font-normal">Aperturas</th>
                <th className="pb-3 font-normal">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {/* Filas de campañas mapeadas aquí */}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function MetricCard({ title, value, trend, alert = false }) {
  return (
    <div className="bg-surface-card p-6 rounded-kura-xl shadow-kura-soft flex flex-col justify-between">
      <span className="text-xs font-medium text-typography-muted tracking-wider">{title}</span>
      <div className="mt-2 flex items-baseline gap-2">
        <span className={`font-heading text-3xl font-semibold ${alert ? 'text-red-600' : 'text-typography'}`}>
          {value}
        </span>
        {trend && <span className="text-sm font-medium text-green-600">{trend}</span>}
      </div>
    </div>
  );
}

```

### **3\. Panel de Verificación de Dominio (DomainVerificationPanel)**

Este panel aborda la reducción cognitiva mediante una alerta educativa sobre sufijos y el bloqueo de interacciones propensas a errores (como la copia manual de texto).

TypeScript

```

// apps/web/src/components/DomainVerificationPanel.tsx
import React, { useState } from 'react';
import { Copy, Check, Loader2 } from 'lucide-react';

export function DomainVerificationPanel({ domainName, status, dnsRecords }) {
  const isVerified = status === 'verified';

  return (
    <div className="max-w-4xl mx-auto bg-surface-card rounded-kura-xl shadow-kura-soft p-8">
      
      {/* Cabecera y Estado */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="font-heading text-2xl font-semibold mb-2">Autentica tu Dominio</h2>
          <p className="text-typography-muted text-sm">
            Para que tus correos lleguen a la bandeja de entrada y no a spam, necesitamos verificar que eres dueño de <strong>{domainName}</strong>.
          </p>
        </div>
        <div className={`px-4 py-1.5 rounded-full flex items-center gap-2 text-sm font-medium ${
          isVerified ? 'bg-[#AFFECA] text-[#014751]' : 'bg-yellow-50 text-amber-700'
        }`}>
          {isVerified ? <Check size={16} /> : <Loader2 size={16} className="animate-spin" />}
          {isVerified ? 'Verificado' : 'Pendiente de verificación'}
        </div>
      </div>

      {/* Alerta Educativa */}
      {!isVerified && (
        <div className="bg-gray-50 border border-gray-100 rounded-kura-md p-4 mb-6">
          <p className="text-sm text-typography">
            ⚠️ <strong>Importante:</strong> Algunos proveedores de dominio (como GoDaddy o Namecheap) añaden tu dominio automáticamente al final. Si es tu caso, copia solo la parte del Nombre antes de <code>.{domainName}</code>.
          </p>
        </div>
      )}

      {/* Tabla de Registros DNS */}
      <div className="flex flex-col gap-4 mb-8">
        <div className="grid grid-cols-12 text-sm font-medium text-typography-muted px-4">
          <div className="col-span-2">Tipo</div>
          <div className="col-span-4">Nombre / Host</div>
          <div className="col-span-6">Valor / Datos</div>
        </div>
        
        {dnsRecords.map((record, index) => (
          <div key={index} className="grid grid-cols-12 items-center gap-4 bg-surface p-4 rounded-kura-md border border-gray-100">
            <div className="col-span-2 font-mono text-sm">{record.type}</div>
            <div className="col-span-4">
              <CopyField value={record.host} />
            </div>
            <div className="col-span-6">
              <CopyField value={record.value} />
            </div>
          </div>
        ))}
      </div>

      {/* Acciones */}
      <div className="flex justify-between items-center border-t border-gray-100 pt-6">
        <button className="text-sm text-primary underline hover:text-primary-hover font-medium">
          ¿Necesitas ayuda con tu proveedor?
        </button>
        <button className="border-2 border-primary text-primary px-6 py-2 rounded-kura-md hover:bg-surface font-medium transition-colors">
          Comprobar estado de validación
        </button>
      </div>
    </div>
  );
}

// Subcomponente de Copiado Interactivo Obligatorio
function CopyField({ value }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2">
      <input 
        type="text" 
        readOnly 
        value={value} 
        className="w-full bg-white border border-gray-200 rounded-kura-sm px-3 py-1.5 font-mono text-xs text-typography focus:outline-none focus:ring-1 focus:ring-accent select-none"
      />
      <button 
        onClick={handleCopy}
        className="p-1.5 rounded-kura-sm hover:bg-gray-200 text-typography transition-colors flex-shrink-0"
        title="Copiar al portapapeles"
      >
        {copied ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
      </button>
    </div>
  );
}

```

Para iniciar la implementación con Opencode CLI y tu modelo Qwen2.5 1.5B, la recomendación técnica es ejecutar el desarrollo en fases incrementales (Scaffolding, Backend, y finalmente Frontend) utilizando el archivo Markdown que acabas de compilar como única fuente de verdad.

A continuación, tienes el *prompt* maestro estructurado con ingeniería de instrucciones (Prompt Engineering) para maximizar la precisión del código generado por la IA.

Copia este texto y ejecútalo en Opencode CLI, asegurándote de tener el archivo KURA arquitectura de aplicación web.md en el mismo directorio desde donde lances el comando.

**Prompt para Opencode CLI:**  
Plaintext

```

Actúa como un Lead Full-Stack Developer experto en Next.js, Cloudflare Workers, y Tailwind CSS. Tu objetivo es programar el MVP del SaaS de email marketing "KURA" basándote estrictamente en las especificaciones del archivo adjunto "KURA arquitectura de aplicación web.md".

Instrucciones de Inicialización y Entorno:
1. Crea un directorio raíz llamado "kura" y establece este directorio como el espacio de trabajo principal.
2. Inicializa un monorepo utilizando npm o pnpm con dos subproyectos principales:
   - "apps/web" (Next.js con App Router, TypeScript y Tailwind CSS).
   - "apps/api-workers" (Cloudflare Workers con TypeScript).
3. Configura el archivo "apps/api-workers/wrangler.toml" exactamente como se especifica en la documentación, definiendo los bindings para D1/Hyperdrive (Supabase) y Cloudflare Queues.
4. Configura el archivo "apps/web/tailwind.config.ts" inyectando la paleta de colores institucional (primary, accent, surface, typography) y las fuentes (Clash Display, Inter, Fira Code) detalladas en la Guía de Estilo.

Fase 1: Base de Datos y Tipado (Backend Core)
1. En "apps/api-workers/src/db/schema.sql", transcribe el Script DDL de PostgreSQL proporcionado en el documento (tablas users, verified_domains, lists, contacts, list_memberships, campaigns, campaign_events).
2. Crea el archivo "packages/core/types.ts" (o dentro de api-workers/src/types) con las interfaces TypeScript definidas en el contrato de datos (TrialStatus, DomainVerificationState, CampaignBuilderState, QueuePayload).

Fase 2: Microservicios y Workers (Motor Asíncrono)
1. Programa el enrutador principal en "apps/api-workers/src/index.ts".
2. Implementa el Productor HTTP en "handlers/sendCampaign.ts" para encolar correos masivos utilizando el método `sendBatch`.
3. Implementa el Consumidor en "queues/emailConsumer.ts" para procesar lotes, integrando el SDK de AWS SES (`@aws-sdk/client-ses`) y el comando `SendBulkTemplatedEmailCommand`.
4. Implementa el motor de telemetría (Edge Tracker) en "tracking/index.ts" para procesar aperturas (píxel 1x1) y redirecciones de clics utilizando `ctx.waitUntil()` para no bloquear el hilo principal.

Fase 3: Frontend y UI (Next.js)
1. Instala las dependencias necesarias en "apps/web": `zustand`, `recharts`, `lucide-react`.
2. Implementa el store global del editor visual en "src/store/useCampaignBuilderStore.ts".
3. Construye los componentes UI asegurando el uso estricto de las clases de Tailwind definidas y los bordes (rounded-kura-md):
   - "MainDashboard.tsx": Con tarjetas de métricas, el gráfico de área (Recharts) y la tabla de campañas.
   - "DomainVerificationPanel.tsx": Con manejo de estado de portapapeles y diseño monoespaciado para los registros DNS.

Restricciones Críticas para la IA:
- NO inventes variables de entorno ni modifiques el esquema de la base de datos sin autorización.
- Utiliza funciones asíncronas estándar y manejo de errores (try/catch) en todas las interacciones con AWS SES y la Base de Datos.
- Todo el código UI debe seguir el paradigma de "Minimalismo Vibrante" con amplio whitespace especificado en el módulo de diseño.
- Genera el código paso a paso, confirmando la creación de cada archivo dentro del directorio "kura".

```

