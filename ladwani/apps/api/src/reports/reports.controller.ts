import { Controller, Get, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { ReportsService } from './reports.service'
import { toCsv } from './csv'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { Permissions } from '../common/decorators/permissions.decorator'

@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Permissions('report:view')
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Get('demographics')
  async demographics() {
    return { data: await this.reports.demographics() }
  }

  @Get('matrimony')
  async matrimony() {
    return { data: await this.reports.matrimony() }
  }

  @Get('services')
  async services() {
    return { data: await this.reports.services() }
  }

  @Get('financial')
  async financial() {
    return { data: await this.reports.financial() }
  }

  @Get('demographics/export.csv')
  async exportDemographicsCsv(@Res() res: Response) {
    const report = await this.reports.demographics()
    this.sendCsv(res, 'demographics.csv', [
      ...report.byGender.map((r) => ({ dimension: 'gender', key: r.gender, count: r.count })),
      ...report.byMaritalStatus.map((r) => ({ dimension: 'maritalStatus', key: r.maritalStatus, count: r.count })),
      ...report.byStatus.map((r) => ({ dimension: 'status', key: r.status, count: r.count })),
      ...report.byAgeBucket.map((r) => ({ dimension: 'ageBucket', key: r.bucket, count: r.count })),
      ...report.byArea.map((r) => ({ dimension: 'area', key: r.area, count: r.count })),
    ])
  }

  @Get('matrimony/export.csv')
  async exportMatrimonyCsv(@Res() res: Response) {
    const report = await this.reports.matrimony()
    this.sendCsv(res, 'matrimony.csv', report.byInterestStatus.map((r) => ({ dimension: 'interestStatus', key: r.status, count: r.count })))
  }

  @Get('services/export.csv')
  async exportServicesCsv(@Res() res: Response) {
    const report = await this.reports.services()
    this.sendCsv(res, 'services.csv', [
      ...report.assetsByCategory.map((r) => ({ dimension: 'assetsByCategory', key: r.category, value: r.count })),
      ...report.assetsByStatus.map((r) => ({ dimension: 'assetsByStatus', key: r.status, value: r.count })),
      ...report.bookingsByStatus.map((r) => ({ dimension: 'bookingsByStatus', key: r.status, value: r.count })),
      ...report.topAssetsByRevenue.map((r) => ({ dimension: 'topAssetsByRevenue', key: r.asset, value: r.revenue })),
    ])
  }

  @Get('financial/export.csv')
  async exportFinancialCsv(@Res() res: Response) {
    const report = await this.reports.financial()
    this.sendCsv(res, 'financial.csv', [
      ...report.ledgerByEntryType.map((r) => ({ dimension: 'ledgerByEntryType', key: r.entryType, count: r.count, amount: r.netAmount })),
      { dimension: 'feeCollection', key: 'billed', count: '', amount: report.feeCollection.billed },
      { dimension: 'feeCollection', key: 'paid', count: '', amount: report.feeCollection.paid },
      { dimension: 'feeCollection', key: 'outstanding', count: '', amount: report.feeCollection.outstanding },
      { dimension: 'donations', key: 'totalPaid', count: report.donations.totalPaidCount, amount: report.donations.totalAmount },
    ])
  }

  private sendCsv(res: Response, filename: string, rows: Record<string, unknown>[]): void {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(toCsv(rows))
  }
}
