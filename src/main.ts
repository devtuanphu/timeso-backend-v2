import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ChatSingleInstanceRuntimeGuardService } from './modules/chat-groups/chat-single-instance-runtime-guard.service';
import { ChatRealtimeCoordinatorService } from './modules/chat-groups/chat-realtime-coordinator.service';
import { CHAT_FATAL_SHUTDOWN_MS } from './modules/chat-groups/chat-realtime.config';
import { configureRequestBodyParsers } from './request-body-parsers';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  configureRequestBodyParsers(app);

  app.enableCors();
  app.setGlobalPrefix('api');

  // Swagger Configuration
  const config = new DocumentBuilder()
    .setTitle('TimeSO API')
    .setDescription('Hệ thống quản lý cửa hàng và ca làm việc - TimeSO')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.init();
  const chatGuard = app.get(ChatSingleInstanceRuntimeGuardService);
  const chatCoordinator = app.get(ChatRealtimeCoordinatorService);
  try {
    await chatGuard.acquireBeforeListen();
    await app.listen(process.env.PORT ?? 3000);
  } catch (error) {
    await chatGuard.release();
    await app.close();
    throw error;
  }
  chatCoordinator.activateAfterListen();
  chatGuard.startHealthMonitor(async () => {
    chatCoordinator.deactivate();
    process.exitCode = 1;
    const forcedExit = setTimeout(() => process.exit(1), CHAT_FATAL_SHUTDOWN_MS);
    forcedExit.unref?.();
    await app.close();
  });
  const url = await app.getUrl();
  console.log(`Application is running on: ${url}`);
  console.log(`Swagger documentation: ${url}/api/docs`);
  console.log('Socket.io chat namespaces initialized');
}
bootstrap().catch((error) => {
  const code =
    error instanceof Error && error.message === 'CHAT_SINGLETON_ALREADY_ACTIVE'
      ? error.message
      : 'BOOTSTRAP_FAILED';
  console.error(`Application bootstrap failed: ${code}`);
  process.exitCode = 1;
});
