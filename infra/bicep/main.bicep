targetScope = 'resourceGroup'

@description('Short environment name, used as a suffix on every resource.')
@allowed(['dev', 'test', 'prod'])
param environment string

@description('Location for all resources.')
param location string = resourceGroup().location

@description('Base name for the estate. Resource names are derived from this.')
@minLength(3)
@maxLength(12)
param baseName string

@description('Service Bus SKU. Topics require Standard or above; Basic supports queues only.')
@allowed(['Standard', 'Premium'])
param serviceBusSku string = 'Standard'

var suffix = '${baseName}-${environment}'

module observability 'modules/observability.bicep' = {
  name: 'observability'
  params: {
    location: location
    suffix: suffix
  }
}

module messaging 'modules/servicebus.bicep' = {
  name: 'messaging'
  params: {
    location: location
    suffix: suffix
    sku: serviceBusSku
  }
}

output applicationInsightsConnectionString string = observability.outputs.connectionString
output serviceBusNamespace string = messaging.outputs.namespaceName
