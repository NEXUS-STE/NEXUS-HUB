import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@nexus-hub/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { UsersService } from './users.service';
import { UpdateUserDto, UpdateUserStatusDto } from './dto/update-user.dto';

@ApiTags('Users')
@ApiBearerAuth('JWT')
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'List all users (admin only)' })
  findAll(@Query('page') page = 1, @Query('limit') limit = 20) {
    return this.usersService.findAll(+page, +limit);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get own profile' })
  me(@CurrentUser('id') userId: string, @CurrentUser('role') role: string) {
    return this.usersService.findOne(userId, role, userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update own profile (airtmAccountId, stellarPublicKey)' })
  update(@CurrentUser('id') userId: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(userId, dto);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Get a specific user by ID (admin only)' })
  findOne(
    @CurrentUser('id') requesterId: string,
    @CurrentUser('role') role: string,
    @Param('id') targetId: string,
  ) {
    return this.usersService.findOne(requesterId, role, targetId);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  @UseGuards(RolesGuard)
  @ApiOperation({ summary: 'Suspend or activate a user (admin only)' })
  updateStatus(
    @CurrentUser('id') adminId: string,
    @Param('id') targetId: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.usersService.updateStatus(adminId, targetId, dto);
  }
}
