param location string
param suffix string
param sku string

// Topics are declared here rather than created at runtime so the estate is reproducible
// and a topic cannot quietly differ between environments.
var topics = [
  'catalogue.item.changed'
  'catalogue.price.changed'
  'inventory.stock.changed'
  'sales.order.statuschanged'
]

resource namespace 'Microsoft.ServiceBus/namespaces@2022-10-01-preview' = {
  name: 'sb-${suffix}'
  location: location
  sku: {
    name: sku
    tier: sku
  }
  properties: {
    minimumTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

resource topicResources 'Microsoft.ServiceBus/namespaces/topics@2022-10-01-preview' = [for topic in topics: {
  parent: namespace
  name: topic
  properties: {
    // Duplicate detection is the broker-side half of the idempotency guarantee in
    // ADR 0005; the consumer-side half is the event id on the envelope.
    requiresDuplicateDetection: true
    duplicateDetectionHistoryTimeWindow: 'PT10M'
    defaultMessageTimeToLive: 'P7D'
    supportOrdering: true
  }
}]

output namespaceName string = namespace.name
output topicNames array = topics
