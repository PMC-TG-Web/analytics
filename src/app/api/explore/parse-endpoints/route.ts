import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

interface PostmanItem {
  name?: string;
  request?: {
    method?: string;
    url?: string | { raw?: string; path?: string[] };
    description?: string;
  };
  item?: PostmanItem[];
}

interface Endpoint {
  method: string;
  path: string;
  name?: string;
  description?: string;
  fullName?: string;
}

interface EndpointGroup {
  [category: string]: Endpoint[];
}

export async function GET(request: NextRequest) {
  try {
    // Read the Postman collection file
    const filePath = path.join(process.cwd(), 'rest_OAS_all_postman.json');
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const collection = JSON.parse(fileContent);

    const endpoints: Endpoint[] = [];

    // Recursive function to extract endpoints from nested structure
    function extractEndpoints(items: PostmanItem[] = [], parentPath = '') {
      items.forEach((item) => {
        const itemName = item.name ? String(item.name) : '';
        
        // If this item has a request, it's an endpoint
        if (item.request && item.request.method && item.request.url) {
          let path = '';
          
          if (typeof item.request.url === 'string') {
            path = item.request.url;
          } else if (item.request.url.raw) {
            try {
              // Extract path from raw URL
              const url = new URL(item.request.url.raw);
              path = url.pathname;
            } catch (e) {
              path = item.request.url.raw || '';
            }
          } else if (item.request.url.path) {
            path = '/' + item.request.url.path.join('/');
          }

          endpoints.push({
            method: String(item.request.method),
            path: String(path),
            name: itemName || undefined,
            description: item.request.description ? String(item.request.description) : undefined,
            fullName: parentPath ? `${parentPath} > ${itemName}` : itemName || undefined,
          });
        }

        // If this item has sub-items, recurse
        if (item.item && item.item.length > 0) {
          const newParentPath = parentPath ? `${parentPath} > ${itemName}` : itemName;
          extractEndpoints(item.item, newParentPath);
        }
      });
    }

    // Start extraction from collection items
    if (collection.item) {
      extractEndpoints(collection.item);
    }

    // Group endpoints by first path segment (resource type)
    const grouped: EndpointGroup = {};
    endpoints.forEach((ep) => {
      // Extract resource from path (e.g., /rest/v1.0/projects -> projects)
      const pathParts = ep.path.split('/').filter((p) => p);
      const resource = pathParts[pathParts.length - 1] || 'other';
      
      if (!grouped[resource]) {
        grouped[resource] = [];
      }
      grouped[resource].push(ep);
    });

    // Sort each group by method and path
    Object.keys(grouped).forEach((key) => {
      grouped[key].sort((a, b) => {
        if (a.method !== b.method) return a.method.localeCompare(b.method);
        return a.path.localeCompare(b.path);
      });
    });

    return NextResponse.json({
      totalEndpoints: endpoints.length,
      uniqueResources: Object.keys(grouped).length,
      resources: grouped,
      sampleEndpoints: endpoints.slice(0, 20),
    });
  } catch (error) {
    console.error('Error parsing endpoints:', error);
    return NextResponse.json(
      { 
        error: 'Failed to parse endpoints',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
