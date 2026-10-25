import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'

type Tx = Prisma.TransactionClient

@Injectable()
export class DonationsService {
  constructor(private prisma: PrismaService) {}

  async listCauses() {
    return this.prisma.donationCause.findMany({ where: { isActive: true } })
  }

  async createCause(code: string, label: string) {
    return this.prisma.donationCause.create({ data: { code, label } })
  }

  async initiateDonation(donorUserId: string, causeCode: string, amount: number) {
    if (amount <= 0) throw new BadRequestException('Donation amount must be positive.')
    const cause = await this.prisma.donationCause.findUnique({ where: { code: causeCode } })
    if (!cause || !cause.isActive) throw new NotFoundException('Unknown or inactive donation cause.')
    return this.prisma.donation.create({ data: { donorUserId, causeId: cause.id, amount } })
  }

  /** Called by PaymentDispatchService once a gateway payment for purposeType=DONATION is verified. */
  async markPaid(tx: Tx, donationId: string, paymentTransactionId: string): Promise<void> {
    await tx.donation.update({ where: { id: donationId }, data: { paymentTransactionId } })
    await tx.financialLedgerEntry.updateMany({ where: { paymentTransactionId }, data: { donationId } })
  }

  async myDonations(userId: string) {
    return this.prisma.donation.findMany({ where: { donorUserId: userId }, include: { cause: true }, orderBy: { createdAt: 'desc' } })
  }
}
