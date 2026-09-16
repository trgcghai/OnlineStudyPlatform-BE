import { AiChatController } from './ai-chat.controller';
import { AiChatService } from './ai-chat.service';

describe('AiChatController', () => {
  let controller: AiChatController;
  let service: { getSession: jest.Mock; sendMessage: jest.Mock };

  const learnerId = '11111111-1111-4111-8111-111111111111';
  const courseId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
    service = {
      getSession: jest.fn(),
      sendMessage: jest.fn(),
    };
    controller = new AiChatController(service as unknown as AiChatService);
  });

  it('delegates chat session loading', async () => {
    const response = { sessionId: 'session-1', messages: [] };
    service.getSession.mockResolvedValue(response);

    await expect(controller.getSession(courseId, learnerId)).resolves.toBe(
      response,
    );
    expect(service.getSession).toHaveBeenCalledWith(learnerId, courseId);
  });

  it('delegates message sending', async () => {
    const response = { reply: { content: 'Tra loi' } };
    service.sendMessage.mockResolvedValue(response);

    await expect(
      controller.sendMessage(courseId, learnerId, { question: 'Noi dung?' }),
    ).resolves.toBe(response);
    expect(service.sendMessage).toHaveBeenCalledWith(
      learnerId,
      courseId,
      'Noi dung?',
    );
  });
});
