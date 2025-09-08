import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NotificationsService } from './notifications/notifications.service';

async function testNotifications() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const notificationsService = app.get(NotificationsService);
  
  try {
    const result = await notificationsService.testNotificationSystem(
      '71aac0ac-4c3b-400b-de2e-08ddc9c59836', 
      'Admin'
    );
    
    console.log('Test notification result:', result);
    
    if (result) {
      console.log('✅ Notifications are working correctly!');
    } else {
      console.log('❌ Notifications are not working');
    }
  } catch (error) {
    console.error('Error testing notifications:', error);
  } finally {
    await app.close();
  }
}

testNotifications();